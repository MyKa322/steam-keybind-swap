import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { SteamDetection, SteamLocation } from '@shared/types'

const execFileAsync = promisify(execFile)

/** Смещение между SteamID64 и AccountID — именем папки в userdata. */
export const STEAM_ID64_BASE = 76561197960265728n

export function accountIdToSteamId64(accountId: string): string {
  return (STEAM_ID64_BASE + BigInt(accountId)).toString()
}

export function steamId64ToAccountId(steamId64: string): string {
  return (BigInt(steamId64) - STEAM_ID64_BASE).toString()
}

/**
 * Ищет установку Steam: сначала реестр пользователя, потом машинный ключ,
 * потом путь по умолчанию. Ручной путь из настроек имеет приоритет над всем.
 */
export async function detectSteam(manualPath: string | null): Promise<SteamDetection> {
  if (manualPath) {
    const location = validate(manualPath, 'manual')
    return location
      ? { location, error: null }
      : { location: null, error: `В указанной папке нет подпапки userdata: ${manualPath}` }
  }

  const candidates: { path: string; source: SteamLocation['source'] }[] = []

  const hkcu = await readRegistryValue('HKCU\\Software\\Valve\\Steam', 'SteamPath')
  if (hkcu) candidates.push({ path: hkcu, source: 'registry-hkcu' })

  const hklm = await readRegistryValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath')
  if (hklm) candidates.push({ path: hklm, source: 'registry-hklm' })

  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  candidates.push({ path: path.join(programFilesX86, 'Steam'), source: 'default-path' })

  for (const candidate of candidates) {
    const location = validate(candidate.path, candidate.source)
    if (location) return { location, error: null }
  }

  return {
    location: null,
    error: 'Не удалось найти установку Steam. Укажите путь вручную в настройках.'
  }
}

function validate(rawPath: string, source: SteamLocation['source']): SteamLocation | null {
  const normalized = path.win32.normalize(rawPath.trim().replace(/[/\\]+$/, ''))
  const userdataPath = path.join(normalized, 'userdata')
  if (!existsSync(userdataPath)) return null
  return { path: normalized, source, userdataPath }
}

/**
 * Читает строковое значение из реестра через reg.exe.
 * Нативных зависимостей не тянем: одна утилита из состава Windows надёжнее
 * пересборки node-модуля под каждую версию Electron.
 */
async function readRegistryValue(key: string, valueName: string): Promise<string | null> {
  try {
    // Полный путь, а не имя: на чужой машине PATH бывает сломан, а посторонний
    // reg.exe в текущей папке подменил бы системный
    const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows'
    const regExe = path.join(systemRoot, 'System32', 'reg.exe')

    const { stdout } = await execFileAsync(regExe, ['query', key, '/v', valueName], {
      windowsHide: true
    })
    // Формат строки: "    SteamPath    REG_SZ    c:/program files (x86)/steam"
    const match = stdout.match(
      new RegExp(`^\\s*${escapeRegExp(valueName)}\\s+REG_[A-Z_]+\\s+(.+?)\\s*$`, 'im')
    )
    return match ? match[1] : null
  } catch {
    return null
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// --- Безопасность путей ----------------------------------------------------

/**
 * Проверяет, что относительный путь безопасен: не абсолютный, без выхода вверх,
 * без Windows-специфики вроде "C:" или UNC.
 *
 * Это не паранойя: relPath приходит в том числе из манифеста импортированного
 * .d2keys, то есть из файла, который мог прислать кто угодно.
 */
export function isSafeRelPath(relPath: string): boolean {
  if (!relPath || relPath.length > 512) return false
  if (relPath.includes('\0')) return false
  if (path.win32.isAbsolute(relPath) || path.posix.isAbsolute(relPath)) return false
  if (/^[a-z]:/i.test(relPath)) return false
  const segments = relPath.split(/[\\/]/)
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/**
 * Собирает абсолютный путь внутри папки игры и гарантирует, что результат
 * действительно остался внутри неё.
 */
export function resolveInside(rootDir: string, relPath: string): string {
  if (!isSafeRelPath(relPath)) {
    throw new Error(`Небезопасный путь: ${relPath}`)
  }
  const resolved = path.resolve(rootDir, relPath)
  const rootWithSep = path.resolve(rootDir) + path.sep
  if (!resolved.startsWith(rootWithSep)) {
    throw new Error(`Путь выходит за пределы папки игры: ${relPath}`)
  }
  return resolved
}

/** Папка игры конкретного аккаунта: <steam>/userdata/<accountId>/<appId> */
export function gameDir(userdataPath: string, accountId: string, appId: string): string {
  if (!/^\d+$/.test(accountId)) throw new Error(`Некорректный accountId: ${accountId}`)
  if (!/^\d+$/.test(appId)) throw new Error(`Некорректный appId: ${appId}`)
  return path.join(userdataPath, accountId, appId)
}
