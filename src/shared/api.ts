import type {
  AppSettings,
  ApplyResult,
  BackupEntry,
  BuildPlanRequest,
  BundleInfo,
  DiffRequest,
  ExportBundleRequest,
  FileDiff,
  GameProfileInfo,
  PreflightResult,
  RestoreResult,
  Result,
  SteamAccount,
  SteamDetection,
  TransferPlan
} from './types'

/**
 * Поверхность, которую preload отдаёт в renderer.
 *
 * Всё возвращает Result вместо исключений: ошибка «не нашли Steam» или
 * «файл занят» — это нормальный ответ, который нужно показать пользователем,
 * а не аварийное состояние. Исключения через IPC приезжают с искажённым
 * текстом и без структуры.
 */
export interface RendererApi {
  steam: {
    detect(): Promise<Result<SteamDetection>>
    pickFolder(): Promise<Result<string | null>>
  }
  games: {
    list(): Promise<Result<GameProfileInfo[]>>
  }
  accounts: {
    list(): Promise<Result<SteamAccount[]>>
    reveal(accountId: string, appId: string): Promise<Result<null>>
  }
  transfer: {
    buildPlan(request: BuildPlanRequest): Promise<Result<TransferPlan>>
    diff(request: DiffRequest): Promise<Result<FileDiff>>
    preflight(appId: string): Promise<Result<PreflightResult>>
    apply(plan: TransferPlan): Promise<Result<ApplyResult>>
  }
  backups: {
    list(): Promise<Result<BackupEntry[]>>
    restore(backupId: string): Promise<Result<RestoreResult>>
    remove(backupId: string): Promise<Result<null>>
    reveal(backupId: string): Promise<Result<null>>
  }
  bundle: {
    export(request: ExportBundleRequest): Promise<Result<string | null>>
    pick(): Promise<Result<BundleInfo | null>>
  }
  settings: {
    get(): Promise<Result<AppSettings>>
    set(patch: Partial<AppSettings>): Promise<Result<AppSettings>>
  }
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    onMaximizedChanged(handler: (maximized: boolean) => void): () => void
  }
}
