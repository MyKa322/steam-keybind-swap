import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DetectedGame, SteamAccount, SteamLocation } from '@shared/types'
import { isKvObject, kvFindObject, kvFindString, parseKeyValues } from './vdf'
import { accountIdToSteamId64 } from './paths'
import { listProfiles, scanGameFiles, selectAllProfileFiles } from '../games/registry'

interface LoginUserInfo {
  accountName: string | null
  personaName: string | null
  lastLogin: number | null
  isAutoLogin: boolean
}

/**
 * Читает config/loginusers.vdf — там Steam хранит логины и ники аккаунтов,
 * которые заходили на этой машине. Аккаунта может там не быть (профиль остался
 * в userdata, но логин удалён) — тогда покажем только числовой ID.
 */
async function readLoginUsers(steamPath: string): Promise<Map<string, LoginUserInfo>> {
  const result = new Map<string, LoginUserInfo>()
  const filePath = path.join(steamPath, 'config', 'loginusers.vdf')

  let text: string
  try {
    text = await fs.readFile(filePath, 'utf8')
  } catch {
    return result
  }

  const root = parseKeyValues(text)
  const users = kvFindObject(root, 'users')
  if (!users) return result

  for (const entry of users) {
    if (!isKvObject(entry.value)) continue
    const timestamp = kvFindString(entry.value, 'Timestamp')
    result.set(entry.key, {
      accountName: kvFindString(entry.value, 'AccountName') ?? null,
      personaName: kvFindString(entry.value, 'PersonaName') ?? null,
      lastLogin: timestamp ? Number(timestamp) : null,
      isAutoLogin: kvFindString(entry.value, 'AutoLogin') === '1'
    })
  }

  return result
}

/**
 * Аватарки Steam кэширует локально, поэтому карточки аккаунтов можно рисовать
 * без единого сетевого запроса. Отдаём data:-URL, чтобы не открывать renderer
 * доступ к файловой системе.
 */
async function readAvatar(steamPath: string, steamId64: string): Promise<string | null> {
  const filePath = path.join(steamPath, 'config', 'avatarcache', `${steamId64}.png`)
  try {
    const buffer = await fs.readFile(filePath)
    // Защита от неожиданно большого файла в кэше — data:-URL раздувает его на треть
    if (buffer.byteLength > 2 * 1024 * 1024) return null
    return `data:image/png;base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}

async function detectGames(userdataPath: string, accountId: string): Promise<DetectedGame[]> {
  const games: DetectedGame[] = []

  for (const profile of listProfiles()) {
    const dir = path.join(userdataPath, accountId, profile.appId)
    try {
      const stat = await fs.stat(dir)
      if (!stat.isDirectory()) continue
    } catch {
      continue
    }

    const allFiles = await scanGameFiles(dir)
    const profileFiles = selectAllProfileFiles(allFiles, profile)

    let lastModified: number | null = null
    for (const file of profileFiles) {
      try {
        const stat = await fs.stat(path.join(dir, file.relPath))
        if (lastModified === null || stat.mtimeMs > lastModified) lastModified = stat.mtimeMs
      } catch {
        // файл исчез между сканированием и stat — просто не учитываем
      }
    }

    games.push({
      appId: profile.appId,
      name: profile.name,
      known: true,
      fileCount: profileFiles.length,
      lastModified
    })
  }

  return games
}

/**
 * Перечисляет аккаунты из userdata. Возвращаются только те, у кого найдена
 * хотя бы одна поддерживаемая игра — остальные папки для этой задачи бесполезны
 * и только засоряют список (их там бывает несколько десятков).
 */
export async function listAccounts(location: SteamLocation): Promise<SteamAccount[]> {
  const loginUsers = await readLoginUsers(location.path)

  let dirents: import('node:fs').Dirent[]
  try {
    dirents = await fs.readdir(location.userdataPath, { withFileTypes: true })
  } catch (error) {
    throw new Error(`Не удалось прочитать ${location.userdataPath}: ${(error as Error).message}`)
  }

  const accounts: SteamAccount[] = []

  for (const dirent of dirents) {
    // В userdata встречается папка "anonymous" и прочий мусор — берём только ID
    if (!dirent.isDirectory() || !/^\d+$/.test(dirent.name) || dirent.name === '0') continue

    const accountId = dirent.name
    const games = await detectGames(location.userdataPath, accountId)
    if (games.length === 0) continue

    const steamId64 = accountIdToSteamId64(accountId)
    const info = loginUsers.get(steamId64)

    accounts.push({
      accountId,
      steamId64,
      accountName: info?.accountName ?? null,
      personaName: info?.personaName ?? null,
      avatarDataUrl: await readAvatar(location.path, steamId64),
      lastLogin: info?.lastLogin ?? null,
      isAutoLogin: info?.isAutoLogin ?? false,
      games
    })
  }

  // Свежие входы наверх, безымянные аккаунты в конец
  accounts.sort((a, b) => (b.lastLogin ?? 0) - (a.lastLogin ?? 0))
  return accounts
}

/** Подпись аккаунта для отчётов и имён бэкапов. */
export function accountLabel(account: SteamAccount): string {
  if (account.personaName) return `${account.personaName} (${account.accountId})`
  if (account.accountName) return `${account.accountName} (${account.accountId})`
  return account.accountId
}
