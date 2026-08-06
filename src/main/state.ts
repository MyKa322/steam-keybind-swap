import path from 'node:path'
import type { AppSettings, SteamAccount, SteamLocation } from '@shared/types'
import { detectSteam } from './steam/paths'
import { listAccounts, accountLabel } from './steam/accounts'
import { loadSettings, saveSettings } from './settings'

/**
 * Состояние процесса main: настройки, найденная установка Steam и короткий кэш
 * списка аккаунтов.
 *
 * Кэш нужен потому, что построение плана и загрузка diff обращаются к списку
 * подряд несколько раз, а каждый обход перечитывает аватарки по сотне килобайт.
 * Живёт секунды — ровно чтобы покрыть одну пользовательскую операцию.
 */
const ACCOUNTS_TTL_MS = 5000

export class AppState {
  private settings: AppSettings
  private location: SteamLocation | null = null
  private locationError: string | null = null
  private accounts: SteamAccount[] = []
  private accountsFetchedAt = 0

  private constructor(
    readonly userDataDir: string,
    settings: AppSettings
  ) {
    this.settings = settings
  }

  static async create(userDataDir: string): Promise<AppState> {
    const state = new AppState(userDataDir, await loadSettings(userDataDir))
    await state.refreshSteamLocation()
    return state
  }

  get backupsRoot(): string {
    return path.join(this.userDataDir, 'backups')
  }

  getSettings(): AppSettings {
    return { ...this.settings }
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const steamPathChanged =
      'steamPathOverride' in patch && patch.steamPathOverride !== this.settings.steamPathOverride

    this.settings = { ...this.settings, ...patch }
    await saveSettings(this.userDataDir, this.settings)

    if (steamPathChanged) {
      await this.refreshSteamLocation()
      this.invalidateAccounts()
    }
    return this.getSettings()
  }

  async refreshSteamLocation(): Promise<void> {
    const detection = await detectSteam(this.settings.steamPathOverride)
    this.location = detection.location
    this.locationError = detection.error
  }

  getDetection(): { location: SteamLocation | null; error: string | null } {
    return { location: this.location, error: this.locationError }
  }

  /** Установка Steam или понятная ошибка — вызывать там, где без неё не обойтись. */
  requireLocation(): SteamLocation {
    if (!this.location) {
      throw new Error(this.locationError ?? 'Установка Steam не найдена')
    }
    return this.location
  }

  invalidateAccounts(): void {
    this.accountsFetchedAt = 0
  }

  async getAccounts(force = false): Promise<SteamAccount[]> {
    const fresh = Date.now() - this.accountsFetchedAt < ACCOUNTS_TTL_MS
    if (!force && fresh && this.accounts.length > 0) return this.accounts

    this.accounts = await listAccounts(this.requireLocation())
    this.accountsFetchedAt = Date.now()
    return this.accounts
  }

  /** Подпись аккаунта для планов, отчётов и имён бэкапов. */
  async labelResolver(): Promise<(accountId: string) => string> {
    const accounts = await this.getAccounts()
    const byId = new Map(accounts.map((account) => [account.accountId, account]))
    return (accountId) => {
      const account = byId.get(accountId)
      return account ? accountLabel(account) : accountId
    }
  }
}
