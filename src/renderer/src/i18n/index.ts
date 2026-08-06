import type { Language } from '@shared/types'
import { ru, type Dict, type DictKey } from './ru'
import { en } from './en'
import { uk } from './uk'

const DICTS: Record<Language, Dict> = { ru, en, uk }

export const LANGUAGE_NAMES: Record<Language, string> = {
  ru: 'Русский',
  en: 'English',
  uk: 'Українська'
}

export type Translate = (key: DictKey, vars?: Record<string, string | number>) => string

export function createTranslate(language: Language): Translate {
  const dict = DICTS[language] ?? ru
  return (key, vars) => {
    let text: string = dict[key] ?? ru[key] ?? key
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(value))
      }
    }
    return text
  }
}

/**
 * Правила для семейств биндов Dota 2.
 *
 * Действий в файле раскладки 154, и большинство из них — однотипные ряды:
 * ControlGroup1..10, Inventory1..6, ShopSlot1..14, десяток режимов наблюдателя.
 * Держать их в словаре по три раза (ru/en/uk) — 460 строк ручного перевода
 * ради предсказуемого результата, поэтому семейства собираются из шаблонов,
 * а поимённо переведено то, что действительно уникально.
 */
const BIND_PATTERNS: { re: RegExp; key: DictKey; base?: boolean }[] = [
  { re: /^ControlGroup(\d+)$/, key: 'pattern.controlGroup' },
  { re: /^Inventory(\d+)AutoCast$/, key: 'pattern.inventoryAutoCast' },
  { re: /^Inventory(\d+)$/, key: 'pattern.inventory' },
  { re: /^ShopSlot(\d+)$/, key: 'pattern.shopSlot' },
  { re: /^ShopTab(.+)$/, key: 'pattern.shopTab' },
  { re: /^SpectatorCameraFocusPlayer(\d+)$/, key: 'pattern.spectatorPlayer' },
  { re: /^NeutralItemSelect(\d+)$/, key: 'pattern.neutralItem' },
  // Автокаст способности достраивается поверх её же перевода
  { re: /^(Ability(?:Primary|Secondary|Ultimate)\w*?)AutoCast$/, key: 'pattern.abilityAutoCast', base: true },
  { re: /^Spectator(.+)$/, key: 'pattern.spectator' }
]

/** Человеческое имя действия: точный перевод, затем шаблон, затем сырой идентификатор. */
export function bindLabel(t: Translate, action: string): string {
  const exact = `bind.${action}` as DictKey
  const translated = t(exact)
  if (translated !== exact) return translated

  for (const pattern of BIND_PATTERNS) {
    const match = action.match(pattern.re)
    if (!match) continue
    if (pattern.base) {
      return t(pattern.key, { base: bindLabel(t, match[1]) })
    }
    return t(pattern.key, { n: humanizeSuffix(match[1]) })
  }

  return action
}

/** Превращает SpectatorDropdown_Lasthits_Denies в «Dropdown Lasthits Denies». */
function humanizeSuffix(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
}

export type { DictKey }
