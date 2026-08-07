/** Контракт между main и renderer. Меняется только здесь, обе стороны типизируются отсюда. */

export type Language = 'ru' | 'en' | 'uk'

// --- Steam -----------------------------------------------------------------

export interface SteamLocation {
  /** Корень установки Steam, например C:\Program Files (x86)\Steam */
  path: string
  /** Откуда узнали путь — показываем в настройках, чтобы было видно, что не угадали */
  source: 'registry-hkcu' | 'registry-hklm' | 'default-path' | 'manual'
  userdataPath: string
}

export interface SteamDetection {
  location: SteamLocation | null
  error: string | null
}

export interface DetectedGame {
  appId: string
  name: string
  /** Есть ли у нас проработанный профиль для этой игры */
  known: boolean
  /** Сколько файлов из профиля реально лежит на диске */
  fileCount: number
  /** Время последнего изменения самого свежего файла профиля (мс), null если файлов нет */
  lastModified: number | null
}

export interface SteamAccount {
  /** Имя папки в userdata, оно же AccountID (SteamID64 − 76561197960265728) */
  accountId: string
  steamId64: string
  /** Логин Steam из loginusers.vdf, если аккаунт там есть */
  accountName: string | null
  /** Ник из loginusers.vdf */
  personaName: string | null
  /** data:-URL аватарки из config/avatarcache, если найдена */
  avatarDataUrl: string | null
  /** Timestamp последнего входа из loginusers.vdf (сек), null если аккаунта там нет */
  lastLogin: number | null
  /** Этот аккаунт помечен в loginusers.vdf как автологин */
  isAutoLogin: boolean
  games: DetectedGame[]
}

// --- Профили игр -----------------------------------------------------------

export interface FileGroupInfo {
  id: string
  /** Ключ в словаре i18n; подписи живут в renderer, main их не знает */
  labelKey: string
  descriptionKey: string
  defaultEnabled: boolean
  /** Предупреждение о специфике группы (например, привязка к железу) */
  advisoryKey: string | null
}

export interface GameProfileInfo {
  appId: string
  name: string
  groups: FileGroupInfo[]
}

// --- План переноса ---------------------------------------------------------

export type TransferSource =
  | { kind: 'account'; accountId: string }
  | { kind: 'bundle'; bundlePath: string; label: string }

/**
 * add — у цели файла нет, будет создан
 * overwrite — файл есть и отличается, будет заменён
 * identical — содержимое совпадает, копировать нечего
 * missing-source — файла нет у источника, пропускаем
 */
export type FileAction = 'add' | 'overwrite' | 'identical' | 'missing-source'

export interface PlannedFile {
  /** Путь относительно папки <appid>, всегда через прямой слэш */
  relPath: string
  groupId: string
  action: FileAction
  sourceSize: number | null
  sourceSha1: string | null
  targetSize: number | null
  targetSha1: string | null
  /** Лежит внутри remote/ — значит участвует в синхронизации Steam Cloud */
  cloudSynced: boolean
}

export interface TargetPlan {
  accountId: string
  label: string
  files: PlannedFile[]
  counts: Record<FileAction, number>
}

export interface TransferPlan {
  appId: string
  appName: string
  source: TransferSource
  sourceLabel: string
  groupIds: string[]
  targets: TargetPlan[]
  createdAt: number
}

export interface BuildPlanRequest {
  appId: string
  source: TransferSource
  targetAccountIds: string[]
  groupIds: string[]
}

// --- Предполётная проверка -------------------------------------------------

export interface PreflightResult {
  /**
   * Список процессов удалось получить. Если false, значениям ниже верить
   * нельзя — проверка не состоялась (политики, антивирус, не Windows)
   */
  checked: boolean
  steamRunning: boolean
  gameRunning: boolean
  /** Имена найденных процессов — показываем пользователю, что именно закрыть */
  processNames: string[]
}

// --- Применение ------------------------------------------------------------

export type AppliedStatus = 'copied' | 'skipped' | 'failed'

export interface AppliedFile {
  relPath: string
  status: AppliedStatus
  error: string | null
}

export interface TargetResult {
  accountId: string
  label: string
  backupId: string | null
  files: AppliedFile[]
  copiedCount: number
  failedCount: number
  /** Сколько записей обновлено в remotecache.vdf */
  remoteCachePatched: number
  remoteCacheError: string | null
}

export interface ApplyResult {
  targets: TargetResult[]
  startedAt: number
  finishedAt: number
  /** Применение шло при запущенном Steam (пользователь включил оверрайд) */
  ranWithSteamOpen: boolean
}

// --- Бэкапы ----------------------------------------------------------------

export interface BackupFileEntry {
  relPath: string
  /** Существовал ли файл до переноса. Если нет — при откате он удаляется */
  existed: boolean
  /** SHA-1 до переноса (null, если файла не было) */
  sha1Before: string | null
  size: number | null
  /** SHA-1 того, что мы записали. Нужен, чтобы не откатывать чужие правки */
  sha1After: string | null
}

export interface BackupEntry {
  id: string
  createdAt: number
  appId: string
  appName: string
  targetAccountId: string
  targetLabel: string
  sourceLabel: string
  files: BackupFileEntry[]
  /** Откат уже применялся */
  restoredAt: number | null
}

export type RestoreStatus = 'restored' | 'removed' | 'skipped-modified' | 'failed'

export interface RestoredFile {
  relPath: string
  status: RestoreStatus
  error: string | null
}

export interface RestoreResult {
  backupId: string
  files: RestoredFile[]
  remoteCachePatched: number
}

// --- Diff ------------------------------------------------------------------

export type DiffStatus = 'added' | 'changed' | 'removed' | 'same'

export interface DiffRow {
  /** Технический ключ, например Keys.AbilityPrimary1.Key */
  key: string
  /** Ключ i18n для человекочитаемой подписи действия, если оно нам известно */
  labelKey: string | null
  /** Ключ i18n для уточнения — какое именно поле действия изменилось */
  fieldKey: string | null
  before: string | null
  after: string | null
  status: DiffStatus
}

export interface FileDiff {
  relPath: string
  kind: 'keyvalues' | 'json' | 'opaque'
  rows: DiffRow[]
  counts: Record<DiffStatus, number>
  /** Пояснение, если diff по содержимому невозможен или урезан */
  noteKey: string | null
  sourceSize: number | null
  targetSize: number | null
  /** Сколько строк отброшено из-за ограничения на размер таблицы */
  truncated: number
}

export interface DiffRequest {
  appId: string
  source: TransferSource
  targetAccountId: string
  relPath: string
}

// --- Бандл .d2keys ---------------------------------------------------------

export interface BundleFile {
  relPath: string
  sha1: string
  size: number
  encoding: 'utf8' | 'base64'
  content: string
}

export interface BundleManifest {
  formatVersion: 1
  appId: string
  appName: string
  createdAt: number
  /** Может быть null, если пользователь снял галку «включать имя аккаунта» */
  sourceLabel: string | null
  groupIds: string[]
  files: BundleFile[]
}

/** Краткая сводка по бандлу для UI — без содержимого файлов */
export interface BundleInfo {
  path: string
  appId: string
  appName: string
  createdAt: number
  sourceLabel: string | null
  groupIds: string[]
  fileCount: number
  totalSize: number
}

export interface ExportBundleRequest {
  appId: string
  accountId: string
  groupIds: string[]
  includeSourceLabel: boolean
}

// --- Настройки -------------------------------------------------------------

export interface AppSettings {
  language: Language
  steamPathOverride: string | null
  /** Обновлять remotecache.vdf после копирования (иначе Steam Cloud откатит бинды) */
  patchRemoteCache: boolean
  /** Разрешить перенос при запущенном Steam — опасно, по умолчанию выключено */
  allowWhenSteamRunning: boolean
  /**
   * Записывать имя аккаунта-источника в экспортируемый файл.
   * Выключается, если файл уходит постороннему: ник в наборе настроек не нужен.
   */
  includeAccountNameInExport: boolean
  lastAppId: string
  lastSourceAccountId: string | null
}

// --- Обёртка результата ----------------------------------------------------

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
