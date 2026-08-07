import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppSettings, Language } from '@shared/types'
import { writeFileAtomic } from './fsutil'

const LANGUAGES: Language[] = ['ru', 'en', 'uk']

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'ru',
  steamPathOverride: null,
  // Без этого Steam Cloud способен откатить только что перенесённые бинды,
  // поэтому по умолчанию включено
  patchRemoteCache: true,
  // Перенос при запущенном Steam почти гарантированно будет перезаписан
  allowWhenSteamRunning: false,
  includeAccountNameInExport: true,
  lastAppId: '570',
  lastSourceAccountId: null
}

function settingsFilePath(userDataDir: string): string {
  return path.join(userDataDir, 'settings.json')
}

export async function loadSettings(userDataDir: string): Promise<AppSettings> {
  try {
    const raw = JSON.parse(await fs.readFile(settingsFilePath(userDataDir), 'utf8')) as unknown
    return sanitize(raw)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveSettings(userDataDir: string, settings: AppSettings): Promise<void> {
  await writeFileAtomic(
    settingsFilePath(userDataDir),
    Buffer.from(JSON.stringify(settings, null, 2), 'utf8')
  )
}

/** Файл настроек мог быть отредактирован руками — берём только валидные поля. */
function sanitize(raw: unknown): AppSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS }
  const value = raw as Record<string, unknown>

  return {
    language: LANGUAGES.includes(value.language as Language)
      ? (value.language as Language)
      : DEFAULT_SETTINGS.language,
    steamPathOverride:
      typeof value.steamPathOverride === 'string' && value.steamPathOverride.trim()
        ? value.steamPathOverride
        : null,
    patchRemoteCache:
      typeof value.patchRemoteCache === 'boolean'
        ? value.patchRemoteCache
        : DEFAULT_SETTINGS.patchRemoteCache,
    allowWhenSteamRunning:
      typeof value.allowWhenSteamRunning === 'boolean'
        ? value.allowWhenSteamRunning
        : DEFAULT_SETTINGS.allowWhenSteamRunning,
    includeAccountNameInExport:
      typeof value.includeAccountNameInExport === 'boolean'
        ? value.includeAccountNameInExport
        : DEFAULT_SETTINGS.includeAccountNameInExport,
    lastAppId:
      typeof value.lastAppId === 'string' && /^\d+$/.test(value.lastAppId)
        ? value.lastAppId
        : DEFAULT_SETTINGS.lastAppId,
    lastSourceAccountId:
      typeof value.lastSourceAccountId === 'string' && /^\d+$/.test(value.lastSourceAccountId)
        ? value.lastSourceAccountId
        : null
  }
}
