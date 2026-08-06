import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export interface FileStat {
  size: number
  mtimeMs: number
}

export async function statFile(filePath: string): Promise<FileStat | null> {
  try {
    const stat = await fs.stat(filePath)
    return stat.isFile() ? { size: stat.size, mtimeMs: stat.mtimeMs } : null
  } catch {
    return null
  }
}

export async function sha1OfFile(filePath: string): Promise<string | null> {
  try {
    const buffer = await fs.readFile(filePath)
    return sha1OfBuffer(buffer)
  } catch {
    return null
  }
}

export function sha1OfBuffer(buffer: Buffer): string {
  return createHash('sha1').update(buffer).digest('hex')
}

/**
 * Запись через временный файл рядом и rename.
 *
 * Прямая запись поверх конфига опасна: если процесс упадёт на середине,
 * у пользователя останется обрезанный файл настроек вместо рабочего.
 * rename в пределах одного тома атомарен.
 */
export async function writeFileAtomic(filePath: string, data: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.kbswap-${process.pid}-${Date.now()}.tmp`
  try {
    await fs.writeFile(tempPath, data)
    await fs.rename(tempPath, filePath)
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {})
    throw error
  }
}

export async function copyFileAtomic(sourcePath: string, targetPath: string): Promise<Buffer> {
  const data = await fs.readFile(sourcePath)
  await writeFileAtomic(targetPath, data)
  return data
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

/**
 * Понятное описание ошибки файловой системы.
 *
 * Голое «EPERM: operation not permitted» ничего не говорит человеку, который
 * просто хочет перенести бинды. Чаще всего за ним стоит одна из трёх причин:
 * папка Steam защищена правами, файл держит другой процесс, или диск заполнен.
 */
export function describeFsError(error: unknown, filePath: string): string {
  const code = (error as NodeJS.ErrnoException)?.code
  const name = path.basename(filePath)

  switch (code) {
    case 'EPERM':
    case 'EACCES':
      return `Нет прав на запись ${name}. Закройте Steam и запустите приложение от имени администратора.`
    case 'EBUSY':
      return `Файл ${name} занят другой программой. Закройте Steam и игру.`
    case 'ENOSPC':
      return 'На диске не осталось свободного места.'
    case 'ENOENT':
      return `Путь недоступен: ${filePath}`
    default:
      return (error as Error)?.message ?? String(error)
  }
}

/** Похож ли файл на текстовый — решает, показывать ли осмысленный diff. */
export function looksBinary(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, 4096)
  for (let i = 0; i < limit; i++) {
    if (buffer[i] === 0) return true
  }
  return false
}
