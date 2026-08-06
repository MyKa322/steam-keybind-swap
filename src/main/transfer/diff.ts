import type { DiffRow, DiffStatus, FileDiff } from '@shared/types'
import { kvFlatten, parseKeyValues } from '../steam/vdf'
import { looksBinary } from '../fsutil'

/**
 * Сравнение содержимого конфигов.
 *
 * Побайтовый diff тут бесполезен: пользователю нужно знать не «строка 412
 * изменилась», а «атака теперь на A вместо Q». Поэтому файл разбирается в
 * плоскую карту «путь → значение», и сравниваются именно значения.
 */

const MAX_ROWS = 800

const KEYVALUES_EXTENSIONS = ['.lst', '.vcfg', '.cfg', '.txt', '.vdf', '.kv']

export function diffKind(relPath: string, buffer: Buffer | null): FileDiff['kind'] {
  if (buffer && looksBinary(buffer)) return 'opaque'
  const lower = relPath.toLowerCase()
  if (lower.endsWith('.json')) return 'json'
  if (KEYVALUES_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'keyvalues'
  return 'opaque'
}

export function buildDiff(relPath: string, source: Buffer | null, target: Buffer | null): FileDiff {
  const kind = diffKind(relPath, source ?? target)
  const base = {
    relPath,
    kind,
    sourceSize: source?.byteLength ?? null,
    targetSize: target?.byteLength ?? null
  }

  if (kind === 'opaque') {
    return {
      ...base,
      rows: [],
      counts: emptyCounts(),
      noteKey: 'diff.note.opaque',
      truncated: 0
    }
  }

  let sourceMap: Map<string, string>
  let targetMap: Map<string, string>
  try {
    sourceMap = source ? flatten(kind, source) : new Map()
    targetMap = target ? flatten(kind, target) : new Map()
  } catch {
    return {
      ...base,
      rows: [],
      counts: emptyCounts(),
      noteKey: 'diff.note.parseFailed',
      truncated: 0
    }
  }

  const allKeys = [...new Set([...targetMap.keys(), ...sourceMap.keys()])].sort()
  const counts = emptyCounts()
  const rows: DiffRow[] = []
  let truncated = 0

  for (const key of allKeys) {
    const before = targetMap.get(key) ?? null
    const after = sourceMap.get(key) ?? null

    let status: DiffStatus
    if (before === null) status = 'added'
    else if (after === null) status = 'removed'
    else if (before === after) status = 'same'
    else status = 'changed'

    counts[status]++

    // Совпадающие строки в таблицу не кладём — их сотни, а лимит один на всех
    if (status === 'same') continue
    if (rows.length >= MAX_ROWS) {
      truncated++
      continue
    }

    rows.push({ ...describeKey(relPath, key), before, after, status })
  }

  return {
    ...base,
    rows,
    counts,
    noteKey: truncated > 0 ? 'diff.note.truncated' : null,
    truncated
  }
}

function flatten(kind: FileDiff['kind'], buffer: Buffer): Map<string, string> {
  const text = buffer.toString('utf8')
  if (kind === 'json') return flattenJson(JSON.parse(text))
  return kvFlatten(parseKeyValues(text))
}

function flattenJson(value: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (value === null || typeof value !== 'object') {
    out.set(prefix || '(значение)', String(value))
    return out
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenJson(item, `${prefix}[${index}]`, out))
    return out
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    flattenJson(item, prefix ? `${prefix}.${key}` : key, out)
  }
  return out
}

/**
 * Приводит технический путь к виду, пригодному для таблицы.
 *
 * Для dotakeys_personal.lst путь выглядит как `KeyBindings.Keys.HeroAttack.Key`.
 * Из него достаётся действие (HeroAttack) и поле (Key или Mode) — так строка
 * читается как «Атака героя · клавиша», а не как путь в дереве.
 */
function describeKey(
  relPath: string,
  key: string
): Pick<DiffRow, 'key' | 'labelKey' | 'fieldKey'> {
  const bindMatch = key.match(/^KeyBindings\.Keys\.([^.]+)\.(Key|Mode)$/i)
  if (bindMatch) {
    return {
      key: `${bindMatch[1]}.${bindMatch[2]}`,
      labelKey: `bind.${bindMatch[1]}`,
      fieldKey: `field.${bindMatch[2].toLowerCase()}`
    }
  }

  const metaMatch = key.match(/^KeyBindings\.([^.]+)$/)
  if (metaMatch) {
    return { key: metaMatch[1], labelKey: `meta.${metaMatch[1]}`, fieldKey: null }
  }

  // Общий случай для .vcfg: config.convars.foo -> convars.foo
  const trimmed = key.replace(/^config\./i, '')
  void relPath
  return { key: trimmed, labelKey: null, fieldKey: null }
}

function emptyCounts(): Record<DiffStatus, number> {
  return { added: 0, changed: 0, removed: 0, same: 0 }
}
