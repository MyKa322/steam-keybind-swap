import { promises as fs } from 'node:fs'
import path from 'node:path'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc'
import type {
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
  TransferPlan,
  AppSettings
} from '@shared/types'
import type { AppState } from './state'
import { getProfile, listProfiles, toProfileInfo } from './games/registry'
import { gameDir, resolveInside } from './steam/paths'
import { preflight } from './steam/process'
import { buildPlan } from './transfer/plan'
import { buildDiff } from './transfer/diff'
import { applyPlan, restore } from './transfer/apply'
import { createSourceReader } from './transfer/source'
import { backupFolderPath, deleteBackup, listBackups } from './transfer/backup'
import { BUNDLE_EXTENSION, buildBundle, readBundle, toBundleInfo, writeBundle } from './bundle/bundle'

/**
 * Регистрация обработчиков IPC.
 *
 * Каждый ответ заворачивается в Result: ошибка вроде «Steam запущен» или
 * «нет прав на файл» — это результат операции, который надо показать
 * пользователю, а не аварийная ситуация. Исключение, проброшенное через IPC,
 * приезжает в renderer с обрезанным текстом и без возможности его разобрать.
 */
function handle<T>(channel: string, fn: (...args: never[]) => Promise<T>): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<Result<T>> => {
    try {
      return { ok: true, value: await fn(...(args as never[])) }
    } catch (error) {
      return { ok: false, error: (error as Error).message || String(error) }
    }
  })
}

function requireProfile(appId: string) {
  const profile = getProfile(appId)
  if (!profile) throw new Error(`Игра ${appId} не поддерживается`)
  return profile
}

export function registerIpc(state: AppState, getWindow: () => BrowserWindow | null): void {
  // --- Steam --------------------------------------------------------------

  handle<SteamDetection>(IPC.steamDetect, async () => {
    await state.refreshSteamLocation()
    state.invalidateAccounts()
    return state.getDetection()
  })

  handle<string | null>(IPC.steamPickFolder, async () => {
    const window = getWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      title: 'Укажите папку установки Steam',
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // --- Игры и аккаунты ----------------------------------------------------

  handle<GameProfileInfo[]>(IPC.gamesList, async () => listProfiles().map(toProfileInfo))

  handle<SteamAccount[]>(IPC.accountsList, async () => state.getAccounts(true))

  handle<null>(IPC.accountReveal, async (accountId: string, appId: string) => {
    const location = state.requireLocation()
    const dir = gameDir(location.userdataPath, accountId, appId)
    await shell.openPath(dir)
    return null
  })

  // --- План и diff --------------------------------------------------------

  handle<TransferPlan>(IPC.planBuild, async (request: BuildPlanRequest) => {
    const location = state.requireLocation()
    const profile = requireProfile(request.appId)
    const labelOf = await state.labelResolver()
    const source = await createSourceReader(
      request.source,
      profile,
      location.userdataPath,
      labelOf
    )

    const targets = request.targetAccountIds.filter(
      (id) => !(request.source.kind === 'account' && id === request.source.accountId)
    )
    if (targets.length === 0) throw new Error('Не выбрано ни одного аккаунта-получателя')

    return buildPlan(
      {
        userdataPath: location.userdataPath,
        profile,
        source,
        sourceKind: request.source,
        accountLabelOf: labelOf
      },
      targets,
      request.groupIds
    )
  })

  handle<FileDiff>(IPC.diffFile, async (request: DiffRequest) => {
    const location = state.requireLocation()
    const profile = requireProfile(request.appId)
    const labelOf = await state.labelResolver()
    const source = await createSourceReader(request.source, profile, location.userdataPath, labelOf)

    const sourceBuffer = await source.readFile(request.relPath)
    const targetPath = resolveInside(
      gameDir(location.userdataPath, request.targetAccountId, request.appId),
      request.relPath
    )
    const targetBuffer = await fs.readFile(targetPath).catch(() => null)

    return buildDiff(request.relPath, sourceBuffer, targetBuffer)
  })

  // --- Перенос ------------------------------------------------------------

  handle<PreflightResult>(IPC.transferPreflight, async (appId: string) =>
    preflight(requireProfile(appId).processNames)
  )

  handle<ApplyResult>(IPC.transferApply, async (plan: TransferPlan) => {
    const location = state.requireLocation()
    const profile = requireProfile(plan.appId)
    const settings = state.getSettings()

    const checks = await preflight(profile.processNames)
    if (checks.gameRunning) {
      throw new Error(
        `Сначала закройте игру: ${checks.processNames.join(', ')}. Она перезапишет конфиг при выходе.`
      )
    }
    if (checks.steamRunning && !settings.allowWhenSteamRunning) {
      throw new Error(
        'Steam запущен. Закройте его полностью — иначе облако вернёт старые бинды поверх скопированных.'
      )
    }
    if (!checks.checked && !settings.allowWhenSteamRunning) {
      // Не смогли получить список процессов. Считать это за «всё закрыто»
      // нельзя: перенос при живом Steam почти наверняка будет откачен облаком.
      throw new Error(
        'Не удалось проверить, запущен ли Steam. Закройте Steam вручную и включите в настройках «Разрешить перенос при запущенном Steam», чтобы продолжить на свой риск.'
      )
    }

    const labelOf = await state.labelResolver()
    const source = await createSourceReader(plan.source, profile, location.userdataPath, labelOf)

    const result = await applyPlan(
      {
        userdataPath: location.userdataPath,
        backupsRoot: state.backupsRoot,
        profile,
        source,
        patchRemoteCacheEnabled: settings.patchRemoteCache,
        steamWasRunning: checks.steamRunning
      },
      plan
    )

    state.invalidateAccounts()
    return result
  })

  // --- Бэкапы -------------------------------------------------------------

  handle<BackupEntry[]>(IPC.backupsList, async () => listBackups(state.backupsRoot))

  handle<RestoreResult>(IPC.backupsRestore, async (backupId: string) => {
    const location = state.requireLocation()
    const entry = (await listBackups(state.backupsRoot)).find((b) => b.id === backupId)
    if (!entry) throw new Error(`Резервная копия не найдена: ${backupId}`)

    const profile = requireProfile(entry.appId)
    const checks = await preflight(profile.processNames)
    if (checks.gameRunning) {
      throw new Error(`Сначала закройте игру: ${checks.processNames.join(', ')}`)
    }
    if (checks.steamRunning && !state.getSettings().allowWhenSteamRunning) {
      throw new Error('Steam запущен. Закройте его перед откатом.')
    }

    const result = await restore(
      {
        userdataPath: location.userdataPath,
        backupsRoot: state.backupsRoot,
        patchRemoteCacheEnabled: state.getSettings().patchRemoteCache
      },
      backupId,
      entry.targetAccountId,
      entry.appId
    )

    state.invalidateAccounts()
    return result
  })

  handle<null>(IPC.backupsDelete, async (backupId: string) => {
    await deleteBackup(state.backupsRoot, backupId)
    return null
  })

  handle<null>(IPC.backupsReveal, async (backupId: string) => {
    await shell.openPath(backupFolderPath(state.backupsRoot, backupId))
    return null
  })

  // --- Экспорт и импорт ---------------------------------------------------

  handle<string | null>(IPC.bundleExport, async (request: ExportBundleRequest) => {
    const window = getWindow()
    if (!window) return null

    const location = state.requireLocation()
    const profile = requireProfile(request.appId)
    const labelOf = await state.labelResolver()
    const source = await createSourceReader(
      { kind: 'account', accountId: request.accountId },
      profile,
      location.userdataPath,
      labelOf
    )

    const files = await source.listFiles(request.groupIds)
    if (files.length === 0) throw new Error('В выбранных группах нет файлов для экспорта')

    const suggested = `${profile.name.replace(/\s+/g, '-').toLowerCase()}-${new Date()
      .toISOString()
      .slice(0, 10)}.${BUNDLE_EXTENSION}`

    const saveResult = await dialog.showSaveDialog(window, {
      title: 'Сохранить набор настроек',
      defaultPath: suggested,
      filters: [{ name: 'Набор настроек', extensions: [BUNDLE_EXTENSION] }]
    })
    if (saveResult.canceled || !saveResult.filePath) return null

    const manifest = await buildBundle({
      appId: profile.appId,
      appName: profile.name,
      sourceLabel: request.includeSourceLabel ? labelOf(request.accountId) : null,
      groupIds: request.groupIds,
      files,
      readFile: (relPath) => source.readFile(relPath)
    })

    await writeBundle(saveResult.filePath, manifest)
    return saveResult.filePath
  })

  handle<BundleInfo | null>(IPC.bundlePick, async () => {
    const window = getWindow()
    if (!window) return null

    const result = await dialog.showOpenDialog(window, {
      title: 'Выберите набор настроек',
      properties: ['openFile'],
      filters: [{ name: 'Набор настроек', extensions: [BUNDLE_EXTENSION] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = result.filePaths[0]
    return toBundleInfo(await readBundle(filePath), filePath)
  })

  // --- Настройки ----------------------------------------------------------

  handle<AppSettings>(IPC.settingsGet, async () => state.getSettings())

  handle<AppSettings>(IPC.settingsSet, async (patch: Partial<AppSettings>) => {
    if (patch.steamPathOverride) {
      // Проверяем сразу, чтобы пользователь узнал об ошибке в момент выбора,
      // а не при следующей операции
      const userdata = path.join(patch.steamPathOverride, 'userdata')
      const stat = await fs.stat(userdata).catch(() => null)
      if (!stat?.isDirectory()) {
        throw new Error(`В папке нет подпапки userdata: ${patch.steamPathOverride}`)
      }
    }
    return state.updateSettings(patch)
  })

  // --- Окно ---------------------------------------------------------------

  ipcMain.on(IPC.windowMinimize, () => getWindow()?.minimize())
  ipcMain.on(IPC.windowToggleMaximize, () => {
    const window = getWindow()
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  ipcMain.on(IPC.windowClose, () => getWindow()?.close())
}
