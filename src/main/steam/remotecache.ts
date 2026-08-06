import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  isKvObject,
  kvFindObject,
  kvFindString,
  kvSet,
  parseKeyValues,
  stringifyKeyValues,
  type KvObject
} from './vdf'
import { statFile, writeFileAtomic } from '../fsutil'

/**
 * Работа с remotecache.vdf — манифестом Steam Cloud для одной игры.
 *
 * Зачем это вообще нужно. В файле на каждый облачный файл записаны size, sha,
 * localtime/time/remotetime. Если подменить конфиг, не тронув манифест, Steam
 * при следующем запуске увидит расхождение между записью и файлом на диске и
 * может привести локальную копию к тому, что помнит облако, — то есть откатить
 * только что скопированные бинды.
 *
 * Формат записи (проверен на реальном файле Dota 2):
 *   "cfg/chat.cfg"
 *   {
 *       "root"  "0"   "size" "196"   "localtime" "1784159525"
 *       "time"  "..."  "remotetime" "..."  "sha" "<sha1 hex>"
 *       "syncstate" "1"  "persiststate" "0"  "platformstosync2" "-1"
 *   }
 * Ключ — путь относительно папки remote/, всегда через прямой слэш.
 */

export interface RemoteCachePatch {
  /** Путь относительно remote/, например "cfg/dotakeys_personal.lst" */
  relPathInRemote: string
  size: number
  sha1: string
  /** Время изменения файла в секундах Unix */
  mtimeSeconds: number
}

export function remoteCachePath(gameDirPath: string): string {
  return path.join(gameDirPath, 'remotecache.vdf')
}

/**
 * Превращает путь внутри папки игры в ключ remotecache.
 * Возвращает null для файлов вне remote/ — они облаком не синхронизируются,
 * и записи для них в манифесте нет.
 */
export function toRemoteCacheKey(relPath: string): string | null {
  const normalized = relPath.replace(/\\/g, '/')
  return normalized.startsWith('remote/') ? normalized.slice('remote/'.length) : null
}

export function isCloudSynced(relPath: string): boolean {
  return toRemoteCacheKey(relPath) !== null
}

/** Ищет блок приложения: обычно единственная запись верхнего уровня с именем appId. */
function findAppBlock(root: KvObject, appId: string): KvObject | null {
  const byId = kvFindObject(root, appId)
  if (byId) return byId
  const firstObject = root.find((entry) => isKvObject(entry.value))
  return firstObject && isKvObject(firstObject.value) ? firstObject.value : null
}

/** Берёт служебные поля у соседней записи, чтобы новая выглядела как родная. */
function templateFields(appBlock: KvObject): { root: string; persiststate: string; platforms: string } {
  for (const entry of appBlock) {
    if (!isKvObject(entry.value)) continue
    const rootValue = kvFindString(entry.value, 'root')
    if (rootValue !== undefined) {
      return {
        root: rootValue,
        persiststate: kvFindString(entry.value, 'persiststate') ?? '0',
        platforms: kvFindString(entry.value, 'platformstosync2') ?? '-1'
      }
    }
  }
  return { root: '0', persiststate: '0', platforms: '-1' }
}

export interface PatchOutcome {
  patched: number
  /** Манифеста нет — Steam соберёт его сам при следующей синхронизации */
  missing: boolean
}

/**
 * Обновляет записи манифеста под новые файлы.
 *
 * remotetime намеренно не трогаем: он описывает версию, лежащую на сервере.
 * Оставляя его прежним, а localtime/time выставляя по новому файлу, мы
 * показываем Steam, что локальная копия свежее облачной, — то есть её нужно
 * выгрузить, а не перекачать поверх.
 */
export async function patchRemoteCache(
  gameDirPath: string,
  appId: string,
  patches: RemoteCachePatch[]
): Promise<PatchOutcome> {
  if (patches.length === 0) return { patched: 0, missing: false }

  const filePath = remoteCachePath(gameDirPath)
  const stat = await statFile(filePath)
  if (!stat) return { patched: 0, missing: true }

  const text = await fs.readFile(filePath, 'utf8')
  const root = parseKeyValues(text)
  const appBlock = findAppBlock(root, appId)
  if (!appBlock) {
    throw new Error(`В remotecache.vdf нет блока приложения ${appId}`)
  }

  const template = templateFields(appBlock)
  let patched = 0

  for (const patch of patches) {
    const key = patch.relPathInRemote
    const existing = kvFindObject(appBlock, key)
    const seconds = String(Math.floor(patch.mtimeSeconds))

    if (existing) {
      kvSet(existing, 'size', String(patch.size))
      kvSet(existing, 'sha', patch.sha1)
      kvSet(existing, 'localtime', seconds)
      kvSet(existing, 'time', seconds)
      kvSet(existing, 'syncstate', '1')
      // remotetime оставляем как есть — см. комментарий к функции
    } else {
      const entry: KvObject = [
        { key: 'root', value: template.root },
        { key: 'size', value: String(patch.size) },
        { key: 'localtime', value: seconds },
        { key: 'time', value: seconds },
        // Записи не было — на сервере этого файла тоже нет
        { key: 'remotetime', value: '0' },
        { key: 'sha', value: patch.sha1 },
        { key: 'syncstate', value: '1' },
        { key: 'persiststate', value: template.persiststate },
        { key: 'platformstosync2', value: template.platforms }
      ]
      appBlock.push({ key, value: entry })
    }
    patched++
  }

  await writeFileAtomic(filePath, Buffer.from(stringifyKeyValues(root), 'utf8'))
  return { patched, missing: false }
}

/**
 * Убирает записи из манифеста. Нужно при откате: если мы создали файл, которого
 * у аккаунта не было, то после его удаления запись в манифесте станет указывать
 * в пустоту.
 */
export async function removeRemoteCacheEntries(
  gameDirPath: string,
  appId: string,
  keys: string[]
): Promise<PatchOutcome> {
  if (keys.length === 0) return { patched: 0, missing: false }

  const filePath = remoteCachePath(gameDirPath)
  const stat = await statFile(filePath)
  if (!stat) return { patched: 0, missing: true }

  const root = parseKeyValues(await fs.readFile(filePath, 'utf8'))
  const appBlock = findAppBlock(root, appId)
  if (!appBlock) return { patched: 0, missing: false }

  const lowered = new Set(keys.map((key) => key.toLowerCase()))
  let removed = 0

  for (let i = appBlock.length - 1; i >= 0; i--) {
    if (isKvObject(appBlock[i].value) && lowered.has(appBlock[i].key.toLowerCase())) {
      appBlock.splice(i, 1)
      removed++
    }
  }

  if (removed > 0) {
    await writeFileAtomic(filePath, Buffer.from(stringifyKeyValues(root), 'utf8'))
  }
  return { patched: removed, missing: false }
}

/** Чтение записи манифеста — используется в тестах и при проверке результата. */
export async function readRemoteCacheEntry(
  gameDirPath: string,
  appId: string,
  relPathInRemote: string
): Promise<Record<string, string> | null> {
  const filePath = remoteCachePath(gameDirPath)
  let text: string
  try {
    text = await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }

  const appBlock = findAppBlock(parseKeyValues(text), appId)
  if (!appBlock) return null

  const entry = kvFindObject(appBlock, relPathInRemote)
  if (!entry) return null

  const result: Record<string, string> = {}
  for (const field of entry) {
    if (!isKvObject(field.value)) result[field.key] = field.value
  }
  return result
}
