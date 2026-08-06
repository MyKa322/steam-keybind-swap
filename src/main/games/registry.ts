import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { GameProfileInfo } from '@shared/types'
import type { GameProfile } from './types'
import { dota2Profile } from './dota2'
import { cs2Profile } from './cs2'

const PROFILES: GameProfile[] = [dota2Profile, cs2Profile]

export function listProfiles(): GameProfile[] {
  return PROFILES
}

export function getProfile(appId: string): GameProfile | undefined {
  return PROFILES.find((p) => p.appId === appId)
}

export function toProfileInfo(profile: GameProfile): GameProfileInfo {
  return {
    appId: profile.appId,
    name: profile.name,
    groups: profile.groups.map((g) => ({
      id: g.id,
      labelKey: g.labelKey,
      descriptionKey: g.descriptionKey,
      defaultEnabled: g.defaultEnabled,
      advisoryKey: g.advisoryKey ?? null
    }))
  }
}

/**
 * Превращает шаблон в регулярку. `*` раскрывается только внутри одного сегмента
 * пути, поэтому `cfg/*.build` не заглянет в подпапки, а `*.vcfg` не совпадёт
 * с `.vcfg_lastclouded` — совпадение якорится с обоих концов.
 */
function patternToRegExp(pattern: string): RegExp {
  const source = pattern
    .split('/')
    .map((segment) =>
      segment
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*')
    )
    .join('/')
  // Файловая система Windows регистронезависима — сравнение тоже
  return new RegExp(`^${source}$`, 'i')
}

const regExpCache = new Map<string, RegExp>()

function cachedRegExp(pattern: string): RegExp {
  let re = regExpCache.get(pattern)
  if (!re) {
    re = patternToRegExp(pattern)
    regExpCache.set(pattern, re)
  }
  return re
}

export function matchesAny(relPath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => cachedRegExp(pattern).test(relPath))
}

/**
 * Рекурсивно собирает все файлы папки игры. Путей тут десятки, поэтому один
 * полный обход дешевле, чем точечные проверки по каждому шаблону, и заодно
 * единообразно обрабатывает шаблоны с `*` в середине пути.
 */
export async function scanGameFiles(gameDirPath: string): Promise<string[]> {
  const found: string[] = []

  async function walk(dir: string, prefix: string): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return // папки может не быть — это норма
    }
    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), relPath)
      } else if (entry.isFile()) {
        found.push(relPath)
      }
    }
  }

  await walk(gameDirPath, '')
  return found.sort()
}

export interface SelectedFile {
  relPath: string
  groupId: string
}

/**
 * Отбирает файлы выбранных групп. Deny-лист проверяется последним и перекрывает
 * группы: даже если шаблон группы случайно зацепит служебный файл Steam,
 * скопирован он не будет.
 */
export function selectFiles(
  allRelPaths: string[],
  profile: GameProfile,
  groupIds: string[]
): SelectedFile[] {
  const groups = profile.groups.filter((g) => groupIds.includes(g.id))
  const selected: SelectedFile[] = []

  for (const relPath of allRelPaths) {
    if (matchesAny(relPath, profile.denyPatterns)) continue
    const group = groups.find((g) => matchesAny(relPath, g.patterns))
    if (group) selected.push({ relPath, groupId: group.id })
  }

  return selected
}

/** Все файлы всех групп профиля — для подсчёта «сколько настроек у аккаунта». */
export function selectAllProfileFiles(allRelPaths: string[], profile: GameProfile): SelectedFile[] {
  return selectFiles(
    allRelPaths,
    profile,
    profile.groups.map((g) => g.id)
  )
}
