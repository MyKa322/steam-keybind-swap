import { promises as fs } from 'node:fs'
import type { BundleFile, BundleInfo, BundleManifest } from '@shared/types'
import { isSafeRelPath } from '../steam/paths'
import { looksBinary, sha1OfBuffer, writeFileAtomic } from '../fsutil'
import type { SelectedFile } from '../games/registry'

/**
 * Формат .d2keys — обычный JSON, а не архив.
 *
 * Конфиги весят десятки килобайт, так что выигрыш от сжатия несуществен, зато
 * файл остаётся человекочитаемым: текстовые конфиги лежат в нём как есть,
 * их видно в любом редакторе. Заодно это минус одна зависимость в проекте.
 */

const MAX_BUNDLE_BYTES = 32 * 1024 * 1024
const MAX_FILES = 2000

export const BUNDLE_EXTENSION = 'd2keys'

export interface BuildBundleInput {
  appId: string
  appName: string
  sourceLabel: string | null
  groupIds: string[]
  files: SelectedFile[]
  readFile: (relPath: string) => Promise<Buffer | null>
}

export async function buildBundle(input: BuildBundleInput): Promise<BundleManifest> {
  const files: BundleFile[] = []

  for (const file of input.files) {
    const buffer = await input.readFile(file.relPath)
    if (!buffer) continue
    const binary = looksBinary(buffer)
    files.push({
      relPath: file.relPath,
      sha1: sha1OfBuffer(buffer),
      size: buffer.byteLength,
      encoding: binary ? 'base64' : 'utf8',
      content: binary ? buffer.toString('base64') : buffer.toString('utf8')
    })
  }

  return {
    formatVersion: 1,
    appId: input.appId,
    appName: input.appName,
    createdAt: Date.now(),
    sourceLabel: input.sourceLabel,
    groupIds: input.groupIds,
    files
  }
}

export async function writeBundle(filePath: string, manifest: BundleManifest): Promise<void> {
  await writeFileAtomic(filePath, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'))
}

/**
 * Читает и проверяет .d2keys.
 *
 * Файл мог прийти из мессенджера от незнакомого человека, поэтому проверяется
 * всё: версия формата, безопасность путей (никаких `..` и абсолютных путей),
 * совпадение SHA-1 с содержимым и суммарный размер.
 */
export async function readBundle(filePath: string): Promise<BundleManifest> {
  const stat = await fs.stat(filePath)
  if (stat.size > MAX_BUNDLE_BYTES) {
    throw new Error(`Файл слишком большой (${formatMb(stat.size)}), максимум ${formatMb(MAX_BUNDLE_BYTES)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch {
    throw new Error('Файл повреждён: не удалось разобрать JSON')
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Файл повреждён: ожидался объект')
  }
  const raw = parsed as Record<string, unknown>

  if (raw.formatVersion !== 1) {
    throw new Error(`Неподдерживаемая версия формата: ${String(raw.formatVersion)}`)
  }
  if (typeof raw.appId !== 'string' || !/^\d+$/.test(raw.appId)) {
    throw new Error('Некорректный appId в файле')
  }
  if (!Array.isArray(raw.files)) {
    throw new Error('В файле нет списка файлов')
  }
  if (raw.files.length > MAX_FILES) {
    throw new Error(`Слишком много файлов в наборе: ${raw.files.length}`)
  }

  const files: BundleFile[] = []
  for (const item of raw.files as unknown[]) {
    files.push(validateBundleFile(item))
  }

  return {
    formatVersion: 1,
    appId: raw.appId,
    appName: typeof raw.appName === 'string' ? raw.appName : raw.appId,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : stat.mtimeMs,
    sourceLabel: typeof raw.sourceLabel === 'string' ? raw.sourceLabel : null,
    groupIds: Array.isArray(raw.groupIds) ? raw.groupIds.filter((g): g is string => typeof g === 'string') : [],
    files
  }
}

function validateBundleFile(item: unknown): BundleFile {
  if (typeof item !== 'object' || item === null) {
    throw new Error('Некорректная запись файла в наборе')
  }
  const raw = item as Record<string, unknown>

  const relPath = raw.relPath
  if (typeof relPath !== 'string' || !isSafeRelPath(relPath)) {
    throw new Error(`Небезопасный путь в наборе: ${String(relPath)}`)
  }
  const encoding = raw.encoding
  if (encoding !== 'utf8' && encoding !== 'base64') {
    throw new Error(`Неизвестная кодировка для ${relPath}`)
  }
  if (typeof raw.content !== 'string') {
    throw new Error(`Нет содержимого для ${relPath}`)
  }

  const buffer =
    encoding === 'base64' ? Buffer.from(raw.content, 'base64') : Buffer.from(raw.content, 'utf8')
  const sha1 = sha1OfBuffer(buffer)
  if (typeof raw.sha1 === 'string' && raw.sha1.toLowerCase() !== sha1) {
    throw new Error(`Контрольная сумма не совпадает для ${relPath} — файл повреждён`)
  }

  return { relPath, sha1, size: buffer.byteLength, encoding, content: raw.content }
}

export function toBundleInfo(manifest: BundleManifest, filePath: string): BundleInfo {
  return {
    path: filePath,
    appId: manifest.appId,
    appName: manifest.appName,
    createdAt: manifest.createdAt,
    sourceLabel: manifest.sourceLabel,
    groupIds: manifest.groupIds,
    fileCount: manifest.files.length,
    totalSize: manifest.files.reduce((sum, f) => sum + f.size, 0)
  }
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}
