import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { BackupEntry, BackupFileEntry, RestoreResult, RestoredFile } from '@shared/types'
import { ensureDir, sha1OfFile, statFile, writeFileAtomic } from '../fsutil'
import { resolveInside } from '../steam/paths'

/**
 * Снимок целевых файлов перед переносом.
 *
 * Хранится обычными файлами в подпапке, а не архивом: так пользователь может
 * забрать свой старый конфиг руками даже если само приложение перестанет
 * запускаться, и не нужна библиотека для zip.
 */

const MANIFEST_NAME = 'manifest.json'
const FILES_DIR = 'files'

export interface BackupMeta {
  appId: string
  appName: string
  targetAccountId: string
  targetLabel: string
  sourceLabel: string
}

function makeBackupId(meta: BackupMeta): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  return `${stamp}-${meta.appId}-${meta.targetAccountId}`
}

function backupDir(backupsRoot: string, id: string): string {
  return path.join(backupsRoot, id)
}

/**
 * Копирует текущие версии файлов цели. Файлы, которых у цели ещё нет,
 * записываются в манифест с existed:false — при откате они будут удалены,
 * иначе «откат» оставил бы после себя чужие настройки.
 */
export async function createBackup(
  backupsRoot: string,
  meta: BackupMeta,
  targetDir: string,
  relPaths: string[]
): Promise<BackupEntry> {
  const id = makeBackupId(meta)
  const dir = backupDir(backupsRoot, id)
  await ensureDir(path.join(dir, FILES_DIR))

  const files: BackupFileEntry[] = []

  for (const relPath of relPaths) {
    const sourcePath = resolveInside(targetDir, relPath)
    const stat = await statFile(sourcePath)

    if (!stat) {
      files.push({ relPath, existed: false, sha1Before: null, size: null, sha1After: null })
      continue
    }

    const data = await fs.readFile(sourcePath)
    await writeFileAtomic(resolveInside(path.join(dir, FILES_DIR), relPath), data)
    files.push({
      relPath,
      existed: true,
      sha1Before: await sha1OfFile(sourcePath),
      size: stat.size,
      sha1After: null
    })
  }

  const entry: BackupEntry = {
    id,
    createdAt: Date.now(),
    appId: meta.appId,
    appName: meta.appName,
    targetAccountId: meta.targetAccountId,
    targetLabel: meta.targetLabel,
    sourceLabel: meta.sourceLabel,
    files,
    restoredAt: null
  }

  await saveManifest(backupsRoot, entry)
  return entry
}

/**
 * Дописывает в манифест SHA-1 того, что мы фактически записали.
 * Без этого откат не смог бы отличить «файл как мы его оставили» от
 * «пользователь с тех пор поменял настройки в игре».
 */
export async function recordWrittenHashes(
  backupsRoot: string,
  entry: BackupEntry,
  written: Map<string, string>
): Promise<BackupEntry> {
  for (const file of entry.files) {
    const sha1 = written.get(file.relPath)
    if (sha1) file.sha1After = sha1
  }
  await saveManifest(backupsRoot, entry)
  return entry
}

async function saveManifest(backupsRoot: string, entry: BackupEntry): Promise<void> {
  await writeFileAtomic(
    path.join(backupDir(backupsRoot, entry.id), MANIFEST_NAME),
    Buffer.from(JSON.stringify(entry, null, 2), 'utf8')
  )
}

export async function listBackups(backupsRoot: string): Promise<BackupEntry[]> {
  let dirents: import('node:fs').Dirent[]
  try {
    dirents = await fs.readdir(backupsRoot, { withFileTypes: true })
  } catch {
    return []
  }

  const entries: BackupEntry[] = []
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue
    const entry = await readManifest(backupsRoot, dirent.name)
    if (entry) entries.push(entry)
  }

  entries.sort((a, b) => b.createdAt - a.createdAt)
  return entries
}

async function readManifest(backupsRoot: string, id: string): Promise<BackupEntry | null> {
  try {
    const text = await fs.readFile(path.join(backupDir(backupsRoot, id), MANIFEST_NAME), 'utf8')
    const parsed = JSON.parse(text) as BackupEntry
    return parsed.id === id && Array.isArray(parsed.files) ? parsed : null
  } catch {
    return null
  }
}

export interface RestoreOutcome extends RestoreResult {
  entry: BackupEntry
  /** Пути, вернувшиеся к прежнему содержимому — их нужно отразить в remotecache */
  restoredPaths: string[]
  /** Пути удалённых файлов — их записи из remotecache надо убрать */
  removedPaths: string[]
}

/**
 * Возвращает файлы цели к состоянию до переноса.
 *
 * Файл, который пользователь успел изменить после переноса, не трогаем:
 * его изменения важнее нашего отката, поэтому такой файл помечается
 * skipped-modified и остаётся как есть.
 */
export async function restoreBackup(
  backupsRoot: string,
  id: string,
  targetDir: string
): Promise<RestoreOutcome> {
  const entry = await readManifest(backupsRoot, id)
  if (!entry) throw new Error(`Резервная копия не найдена: ${id}`)

  const dir = backupDir(backupsRoot, id)
  const files: RestoredFile[] = []
  const restoredPaths: string[] = []
  const removedPaths: string[] = []

  for (const file of entry.files) {
    const targetPath = resolveInside(targetDir, file.relPath)
    const currentSha1 = await sha1OfFile(targetPath)

    // Файл изменился уже после нашего переноса — это правки пользователя
    if (file.sha1After && currentSha1 && currentSha1 !== file.sha1After) {
      files.push({ relPath: file.relPath, status: 'skipped-modified', error: null })
      continue
    }

    try {
      if (file.existed) {
        const data = await fs.readFile(resolveInside(path.join(dir, FILES_DIR), file.relPath))
        await writeFileAtomic(targetPath, data)
        files.push({ relPath: file.relPath, status: 'restored', error: null })
        restoredPaths.push(file.relPath)
      } else if (currentSha1 !== null) {
        await fs.rm(targetPath, { force: true })
        files.push({ relPath: file.relPath, status: 'removed', error: null })
        removedPaths.push(file.relPath)
      } else {
        files.push({ relPath: file.relPath, status: 'skipped-modified', error: null })
      }
    } catch (error) {
      files.push({ relPath: file.relPath, status: 'failed', error: (error as Error).message })
    }
  }

  entry.restoredAt = Date.now()
  await saveManifest(backupsRoot, entry)

  return { backupId: id, files, remoteCachePatched: 0, entry, restoredPaths, removedPaths }
}

export async function deleteBackup(backupsRoot: string, id: string): Promise<void> {
  const dir = backupDir(backupsRoot, id)
  // Защита от произвольного id, пришедшего из renderer
  const resolved = path.resolve(dir)
  if (!resolved.startsWith(path.resolve(backupsRoot) + path.sep)) {
    throw new Error(`Некорректный идентификатор копии: ${id}`)
  }
  await fs.rm(resolved, { recursive: true, force: true })
}

export function backupFolderPath(backupsRoot: string, id: string): string {
  return backupDir(backupsRoot, id)
}
