import { create } from 'zustand'
import type {
  AppSettings,
  ApplyResult,
  BackupEntry,
  BundleInfo,
  GameProfileInfo,
  PreflightResult,
  Result,
  SteamAccount,
  SteamDetection,
  TransferPlan,
  TransferSource
} from '@shared/types'

export type View = 'transfer' | 'backups' | 'settings'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
}

/** Разворачивает Result: удобные места вызова остаются без if-ов на каждый шаг. */
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error)
  return result.value
}

interface AppStore {
  ready: boolean
  view: View
  settings: AppSettings | null
  detection: SteamDetection | null
  games: GameProfileInfo[]
  accounts: SteamAccount[]
  accountsLoading: boolean

  appId: string
  sourceAccountId: string | null
  bundle: BundleInfo | null
  targetIds: string[]
  groupIds: string[]

  plan: TransferPlan | null
  /**
   * План построен, но выбор с тех пор изменился.
   *
   * Устаревший план не выбрасывается, а помечается: если убрать его из DOM,
   * страница резко укорачивается, прокрутка прижимается к новому максимуму и
   * пользователя выбрасывает из того места, которое он читал.
   */
  planStale: boolean
  planLoading: boolean
  preflight: PreflightResult | null
  applying: boolean
  applyResult: ApplyResult | null

  backups: BackupEntry[]
  toasts: Toast[]

  init(): Promise<void>
  setView(view: View): void
  setAppId(appId: string): void
  setSourceAccount(accountId: string): void
  pickBundle(): Promise<void>
  clearBundle(): void
  toggleTarget(accountId: string): void
  setAllTargets(selected: boolean): void
  toggleGroup(groupId: string): void
  refreshAccounts(): Promise<void>
  refreshPreflight(): Promise<void>
  buildPlan(): Promise<void>
  clearPlan(): void
  apply(): Promise<void>
  dismissApplyResult(): void
  loadBackups(): Promise<void>
  restoreBackup(backupId: string): Promise<void>
  deleteBackup(backupId: string): Promise<void>
  revealBackup(backupId: string): Promise<void>
  exportBundle(includeSourceLabel: boolean): Promise<void>
  updateSettings(patch: Partial<AppSettings>): Promise<void>
  pickSteamFolder(): Promise<void>
  toast(kind: Toast['kind'], text: string): void
  dismissToast(id: number): void
}

let toastId = 0

/**
 * Помечает построенный план устаревшим, не трогая его содержимое.
 * Если плана нет, состояние не меняется — иначе появлялось бы предупреждение
 * об устаревании там, где показывать нечего.
 */
function staleUpdate(plan: TransferPlan | null): { planStale: boolean } | Record<string, never> {
  return plan ? { planStale: true } : {}
}

export const useApp = create<AppStore>((set, get) => ({
  ready: false,
  view: 'transfer',
  settings: null,
  detection: null,
  games: [],
  accounts: [],
  accountsLoading: false,

  appId: '570',
  sourceAccountId: null,
  bundle: null,
  targetIds: [],
  groupIds: [],

  plan: null,
  planStale: false,
  planLoading: false,
  preflight: null,
  applying: false,
  applyResult: null,

  backups: [],
  toasts: [],

  async init() {
    try {
      const settings = unwrap(await window.api.settings.get())
      const detection = unwrap(await window.api.steam.detect())
      const games = unwrap(await window.api.games.list())

      const appId = games.some((g) => g.appId === settings.lastAppId)
        ? settings.lastAppId
        : (games[0]?.appId ?? '570')

      set({
        settings,
        detection,
        games,
        appId,
        groupIds: defaultGroups(games, appId),
        ready: true
      })

      if (detection.location) {
        await get().refreshAccounts()
        await get().refreshPreflight()
      }
    } catch (error) {
      set({ ready: true })
      get().toast('error', (error as Error).message)
    }
  },

  setView(view) {
    set({ view })
    if (view === 'backups') void get().loadBackups()
  },

  setAppId(appId) {
    const { games, settings, sourceAccountId, accounts } = get()
    // Аккаунт-источник может не иметь новой игры — тогда сбрасываем выбор
    const sourceStillValid =
      sourceAccountId !== null &&
      accounts.some((a) => a.accountId === sourceAccountId && a.games.some((g) => g.appId === appId))

    // Смена игры — единственный случай, когда план действительно выбрасывается:
    // он относился к другому набору файлов, а выбор источника и получателей
    // всё равно сбрасывается
    set({
      appId,
      groupIds: defaultGroups(games, appId),
      sourceAccountId: sourceStillValid ? sourceAccountId : null,
      targetIds: [],
      plan: null,
      planStale: false
    })
    if (settings) void window.api.settings.set({ lastAppId: appId })
    void get().refreshPreflight()
  },

  setSourceAccount(accountId) {
    set((state) => ({
      sourceAccountId: accountId,
      bundle: null,
      targetIds: state.targetIds.filter((id) => id !== accountId),
      ...staleUpdate(state.plan)
    }))
    void window.api.settings.set({ lastSourceAccountId: accountId })
  },

  async pickBundle() {
    try {
      const bundle = unwrap(await window.api.bundle.pick())
      if (!bundle) return
      if (bundle.appId !== get().appId) {
        get().toast('error', `Набор собран для другой игры (appid ${bundle.appId})`)
        return
      }
      set((state) => ({ bundle, sourceAccountId: null, ...staleUpdate(state.plan) }))
    } catch (error) {
      get().toast('error', (error as Error).message)
    }
  },

  clearBundle() {
    set((state) => ({ bundle: null, ...staleUpdate(state.plan) }))
  },

  toggleTarget(accountId) {
    set((state) => ({
      targetIds: state.targetIds.includes(accountId)
        ? state.targetIds.filter((id) => id !== accountId)
        : [...state.targetIds, accountId],
      ...staleUpdate(state.plan)
    }))
  },

  setAllTargets(selected) {
    const { accounts, appId, sourceAccountId, plan } = get()
    set({
      targetIds: selected
        ? accounts
            .filter((a) => a.games.some((g) => g.appId === appId) && a.accountId !== sourceAccountId)
            .map((a) => a.accountId)
        : [],
      ...staleUpdate(plan)
    })
  },

  toggleGroup(groupId) {
    set((state) => ({
      groupIds: state.groupIds.includes(groupId)
        ? state.groupIds.filter((id) => id !== groupId)
        : [...state.groupIds, groupId],
      ...staleUpdate(state.plan)
    }))
  },

  async refreshAccounts() {
    set({ accountsLoading: true })
    try {
      const accounts = unwrap(await window.api.accounts.list())
      const { appId, sourceAccountId, settings } = get()

      const withGame = accounts.filter((a) => a.games.some((g) => g.appId === appId))
      const preferred =
        sourceAccountId ??
        (settings?.lastSourceAccountId &&
        withGame.some((a) => a.accountId === settings.lastSourceAccountId)
          ? settings.lastSourceAccountId
          : null)

      set({
        accounts,
        sourceAccountId: withGame.some((a) => a.accountId === preferred) ? preferred : null
      })
    } catch (error) {
      get().toast('error', (error as Error).message)
    } finally {
      set({ accountsLoading: false })
    }
  },

  async refreshPreflight() {
    try {
      set({ preflight: unwrap(await window.api.transfer.preflight(get().appId)) })
    } catch {
      set({ preflight: null })
    }
  },

  async buildPlan() {
    const { appId, sourceAccountId, bundle, targetIds, groupIds } = get()
    const source: TransferSource | null = bundle
      ? { kind: 'bundle', bundlePath: bundle.path, label: bundle.sourceLabel ?? bundle.appName }
      : sourceAccountId
        ? { kind: 'account', accountId: sourceAccountId }
        : null

    if (!source || targetIds.length === 0 || groupIds.length === 0) return

    set({ planLoading: true })
    try {
      const plan = unwrap(
        await window.api.transfer.buildPlan({
          appId,
          source,
          targetAccountIds: targetIds,
          groupIds
        })
      )
      set({ plan, planStale: false })
    } catch (error) {
      set({ plan: null, planStale: false })
      get().toast('error', (error as Error).message)
    } finally {
      set({ planLoading: false })
    }
  },

  clearPlan() {
    set({ plan: null, planStale: false })
  },

  async apply() {
    const { plan, planStale } = get()
    // Устаревший план применять нельзя: выбор изменился уже после его расчёта
    if (!plan || planStale) return

    set({ applying: true })
    try {
      const result = unwrap(await window.api.transfer.apply(plan))
      // План остаётся на экране, но помечается устаревшим: файлы уже
      // скопированы, и прежние пометки «заменить» больше не соответствуют диску
      set({ applyResult: result, planStale: true })
      await get().refreshAccounts()
      await get().loadBackups()
    } catch (error) {
      get().toast('error', (error as Error).message)
      await get().refreshPreflight()
    } finally {
      set({ applying: false })
    }
  },

  dismissApplyResult() {
    set({ applyResult: null })
  },

  async loadBackups() {
    try {
      set({ backups: unwrap(await window.api.backups.list()) })
    } catch (error) {
      get().toast('error', (error as Error).message)
    }
  },

  async restoreBackup(backupId) {
    try {
      const result = unwrap(await window.api.backups.restore(backupId))
      const restored = result.files.filter((f) => f.status === 'restored').length
      const removed = result.files.filter((f) => f.status === 'removed').length
      const skipped = result.files.filter((f) => f.status === 'skipped-modified').length
      get().toast(
        'success',
        `Откат: возвращено ${restored}, удалено ${removed}, пропущено ${skipped}`
      )
      await get().loadBackups()
      await get().refreshAccounts()
    } catch (error) {
      get().toast('error', (error as Error).message)
    }
  },

  async deleteBackup(backupId) {
    try {
      unwrap(await window.api.backups.remove(backupId))
      await get().loadBackups()
    } catch (error) {
      get().toast('error', (error as Error).message)
    }
  },

  async revealBackup(backupId) {
    await window.api.backups.reveal(backupId)
  },

  async exportBundle(includeSourceLabel) {
    const { appId, sourceAccountId, groupIds } = get()
    if (!sourceAccountId) return
    try {
      const savedPath = unwrap(
        await window.api.bundle.export({
          appId,
          accountId: sourceAccountId,
          groupIds,
          includeSourceLabel
        })
      )
      if (savedPath) get().toast('success', `Сохранено: ${savedPath}`)
    } catch (error) {
      get().toast('error', (error as Error).message)
    }
  },

  async updateSettings(patch) {
    try {
      const settings = unwrap(await window.api.settings.set(patch))
      set({ settings })
      if ('steamPathOverride' in patch) {
        set({ detection: unwrap(await window.api.steam.detect()) })
        await get().refreshAccounts()
      }
    } catch (error) {
      get().toast('error', (error as Error).message)
    }
  },

  async pickSteamFolder() {
    try {
      const folder = unwrap(await window.api.steam.pickFolder())
      if (folder) await get().updateSettings({ steamPathOverride: folder })
    } catch (error) {
      get().toast('error', (error as Error).message)
    }
  },

  toast(kind, text) {
    const id = ++toastId
    set((state) => ({ toasts: [...state.toasts, { id, kind, text }] }))
    // Ошибки держим дольше: их обычно нужно успеть прочитать целиком
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 4500)
  },

  dismissToast(id) {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
  }
}))

function defaultGroups(games: GameProfileInfo[], appId: string): string[] {
  const game = games.find((g) => g.appId === appId)
  return game ? game.groups.filter((g) => g.defaultEnabled).map((g) => g.id) : []
}
