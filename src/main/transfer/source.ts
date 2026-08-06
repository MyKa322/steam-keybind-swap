import { promises as fs } from 'node:fs'
import type { BundleManifest, TransferSource } from '@shared/types'
import type { GameProfile } from '../games/types'
import { scanGameFiles, selectFiles, type SelectedFile } from '../games/registry'
import { gameDir, isSafeRelPath, resolveInside } from '../steam/paths'
import { readBundle } from '../bundle/bundle'

/**
 * Единый интерфейс поверх двух видов источника: папки аккаунта и файла .d2keys.
 * Благодаря ему план, diff и применение не знают, откуда взялись файлы, —
 * импорт бандла проходит ровно тот же путь, что и обычный перенос, включая
 * бэкап и патч remotecache.
 */
export interface SourceReader {
  label: string
  listFiles(groupIds: string[]): Promise<SelectedFile[]>
  readFile(relPath: string): Promise<Buffer | null>
}

class AccountSource implements SourceReader {
  private cache: string[] | null = null

  constructor(
    readonly label: string,
    private readonly dirPath: string,
    private readonly profile: GameProfile
  ) {}

  private async allFiles(): Promise<string[]> {
    if (!this.cache) this.cache = await scanGameFiles(this.dirPath)
    return this.cache
  }

  async listFiles(groupIds: string[]): Promise<SelectedFile[]> {
    return selectFiles(await this.allFiles(), this.profile, groupIds)
  }

  async readFile(relPath: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(resolveInside(this.dirPath, relPath))
    } catch {
      return null
    }
  }
}

class BundleSource implements SourceReader {
  constructor(
    readonly label: string,
    private readonly manifest: BundleManifest,
    private readonly profile: GameProfile
  ) {}

  async listFiles(groupIds: string[]): Promise<SelectedFile[]> {
    const relPaths = this.manifest.files
      .map((f) => f.relPath)
      // Манифест пришёл из файла, который мог собрать кто угодно, — путям не доверяем
      .filter((relPath) => isSafeRelPath(relPath))
    return selectFiles(relPaths.sort(), this.profile, groupIds)
  }

  async readFile(relPath: string): Promise<Buffer | null> {
    const file = this.manifest.files.find((f) => f.relPath === relPath)
    if (!file) return null
    return file.encoding === 'base64'
      ? Buffer.from(file.content, 'base64')
      : Buffer.from(file.content, 'utf8')
  }
}

export async function createSourceReader(
  source: TransferSource,
  profile: GameProfile,
  userdataPath: string,
  accountLabelOf: (accountId: string) => string
): Promise<SourceReader> {
  if (source.kind === 'account') {
    return new AccountSource(
      accountLabelOf(source.accountId),
      gameDir(userdataPath, source.accountId, profile.appId),
      profile
    )
  }

  const manifest = await readBundle(source.bundlePath)
  if (manifest.appId !== profile.appId) {
    throw new Error(
      `Файл собран для другой игры (appid ${manifest.appId}, ожидается ${profile.appId})`
    )
  }
  return new BundleSource(source.label || manifest.sourceLabel || 'Файл', manifest, profile)
}
