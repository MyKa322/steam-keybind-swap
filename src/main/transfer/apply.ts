import type {
  AppliedFile,
  ApplyResult,
  RestoreResult,
  TargetResult,
  TransferPlan
} from '@shared/types'
import type { GameProfile } from '../games/types'
import { selectFiles } from '../games/registry'
import { gameDir, resolveInside } from '../steam/paths'
import { describeFsError, sha1OfBuffer, sha1OfFile, statFile, writeFileAtomic } from '../fsutil'
import {
  patchRemoteCache,
  removeRemoteCacheEntries,
  toRemoteCacheKey,
  type RemoteCachePatch
} from '../steam/remotecache'
import { createBackup, recordWrittenHashes, restoreBackup } from './backup'
import { filesToWrite } from './plan'
import type { SourceReader } from './source'

export interface ApplyDeps {
  userdataPath: string
  backupsRoot: string
  profile: GameProfile
  source: SourceReader
  patchRemoteCacheEnabled: boolean
  steamWasRunning: boolean
}

/**
 * Выполняет план: бэкап → запись файлов → обновление манифеста Steam Cloud.
 *
 * Порядок принципиален. Бэкап делается до первой записи, чтобы откат был
 * возможен даже если процесс упадёт на середине. Манифест правится последним,
 * когда все файлы уже на диске и их контрольные суммы известны.
 */
export async function applyPlan(deps: ApplyDeps, plan: TransferPlan): Promise<ApplyResult> {
  const startedAt = Date.now()
  const targets: TargetResult[] = []

  for (const target of plan.targets) {
    targets.push(await applyToTarget(deps, plan, target))
  }

  return {
    targets,
    startedAt,
    finishedAt: Date.now(),
    ranWithSteamOpen: deps.steamWasRunning
  }
}

async function applyToTarget(
  deps: ApplyDeps,
  plan: TransferPlan,
  target: TransferPlan['targets'][number]
): Promise<TargetResult> {
  const targetDir = gameDir(deps.userdataPath, target.accountId, deps.profile.appId)

  // План приезжает из renderer, поэтому список файлов перепроверяется по
  // профилю заново: записать можно только то, что разрешено выбранными
  // группами и не попало в deny-лист.
  const allowed = new Set(
    selectFiles(
      filesToWrite(target).map((f) => f.relPath),
      deps.profile,
      plan.groupIds
    ).map((f) => f.relPath)
  )
  const pending = filesToWrite(target).filter((f) => allowed.has(f.relPath))

  if (pending.length === 0) {
    return {
      accountId: target.accountId,
      label: target.label,
      backupId: null,
      files: [],
      copiedCount: 0,
      failedCount: 0,
      remoteCachePatched: 0,
      remoteCacheError: null
    }
  }

  const backup = await createBackup(
    deps.backupsRoot,
    {
      appId: plan.appId,
      appName: plan.appName,
      targetAccountId: target.accountId,
      targetLabel: target.label,
      sourceLabel: plan.sourceLabel
    },
    targetDir,
    pending.map((f) => f.relPath)
  )

  const files: AppliedFile[] = []
  const written = new Map<string, string>()
  const cachePatches: RemoteCachePatch[] = []

  for (const planned of pending) {
    try {
      const buffer = await deps.source.readFile(planned.relPath)
      if (!buffer) {
        files.push({ relPath: planned.relPath, status: 'skipped', error: 'Файл исчез у источника' })
        continue
      }

      const targetPath = resolveInside(targetDir, planned.relPath)
      await writeFileAtomic(targetPath, buffer)

      const sha1 = sha1OfBuffer(buffer)

      // Перечитываем записанное. Антивирус, синхронизация или сам Steam могут
      // подменить файл сразу после записи — тогда в манифест уйдёт контрольная
      // сумма того, чего на диске нет, и облако начнёт считать копию битой.
      const writtenSha1 = await sha1OfFile(targetPath)
      if (writtenSha1 !== sha1) {
        files.push({
          relPath: planned.relPath,
          status: 'failed',
          error: 'Записанный файл отличается от исходного — возможно, его изменила другая программа'
        })
        continue
      }

      written.set(planned.relPath, sha1)
      files.push({ relPath: planned.relPath, status: 'copied', error: null })

      const cacheKey = toRemoteCacheKey(planned.relPath)
      if (cacheKey) {
        // Берём реальное время файла с диска, а не Date.now(): именно его
        // сравнит Steam с записью в манифесте
        const stat = await statFile(targetPath)
        cachePatches.push({
          relPathInRemote: cacheKey,
          size: buffer.byteLength,
          sha1,
          mtimeSeconds: (stat?.mtimeMs ?? Date.now()) / 1000
        })
      }
    } catch (error) {
      files.push({
        relPath: planned.relPath,
        status: 'failed',
        error: describeFsError(error, planned.relPath)
      })
    }
  }

  await recordWrittenHashes(deps.backupsRoot, backup, written)

  let remoteCachePatched = 0
  let remoteCacheError: string | null = null

  if (deps.patchRemoteCacheEnabled && cachePatches.length > 0) {
    try {
      const outcome = await patchRemoteCache(targetDir, plan.appId, cachePatches)
      remoteCachePatched = outcome.patched
      if (outcome.missing) {
        remoteCacheError = 'remotecache.vdf не найден — Steam пересоберёт его сам'
      }
    } catch (error) {
      remoteCacheError = (error as Error).message
    }
  }

  return {
    accountId: target.accountId,
    label: target.label,
    backupId: backup.id,
    files,
    copiedCount: files.filter((f) => f.status === 'copied').length,
    failedCount: files.filter((f) => f.status === 'failed').length,
    remoteCachePatched,
    remoteCacheError
  }
}

export interface RestoreDeps {
  userdataPath: string
  backupsRoot: string
  patchRemoteCacheEnabled: boolean
}

/**
 * Откат: возвращает файлы и приводит манифест Steam Cloud в соответствие —
 * восстановленным файлам обновляет size/sha, удалённым убирает записи.
 */
export async function restore(
  deps: RestoreDeps,
  backupId: string,
  targetAccountId: string,
  appId: string
): Promise<RestoreResult> {
  const targetDir = gameDir(deps.userdataPath, targetAccountId, appId)
  const outcome = await restoreBackup(deps.backupsRoot, backupId, targetDir)

  if (!deps.patchRemoteCacheEnabled) {
    return { backupId: outcome.backupId, files: outcome.files, remoteCachePatched: 0 }
  }

  let patched = 0

  const patches: RemoteCachePatch[] = []
  for (const relPath of outcome.restoredPaths) {
    const cacheKey = toRemoteCacheKey(relPath)
    if (!cacheKey) continue
    const targetPath = resolveInside(targetDir, relPath)
    const stat = await statFile(targetPath)
    if (!stat) continue
    const entry = outcome.entry.files.find((f) => f.relPath === relPath)
    if (!entry?.sha1Before) continue
    patches.push({
      relPathInRemote: cacheKey,
      size: stat.size,
      sha1: entry.sha1Before,
      mtimeSeconds: stat.mtimeMs / 1000
    })
  }

  try {
    if (patches.length > 0) {
      patched += (await patchRemoteCache(targetDir, appId, patches)).patched
    }

    const removedKeys = outcome.removedPaths
      .map(toRemoteCacheKey)
      .filter((key): key is string => key !== null)
    if (removedKeys.length > 0) {
      patched += (await removeRemoteCacheEntries(targetDir, appId, removedKeys)).patched
    }
  } catch {
    // Откат файлов уже произошёл и он важнее; манифест Steam пересоберёт сам
  }

  return { backupId: outcome.backupId, files: outcome.files, remoteCachePatched: patched }
}
