import type { FileAction, PlannedFile, TargetPlan, TransferPlan, TransferSource } from '@shared/types'
import type { GameProfile } from '../games/types'
import { gameDir, resolveInside } from '../steam/paths'
import { isCloudSynced } from '../steam/remotecache'
import { sha1OfBuffer, statFile, sha1OfFile } from '../fsutil'
import type { SourceReader } from './source'

export interface PlanDeps {
  userdataPath: string
  profile: GameProfile
  source: SourceReader
  sourceKind: TransferSource
  accountLabelOf: (accountId: string) => string
}

const EMPTY_COUNTS: Record<FileAction, number> = {
  add: 0,
  overwrite: 0,
  identical: 0,
  'missing-source': 0
}

/**
 * Считает, что именно произойдёт с каждым файлом каждой цели, ничего не меняя
 * на диске. Тот же план потом уходит в применение — то, что пользователь видел
 * в предпросмотре, и есть то, что выполнится.
 */
export async function buildPlan(
  deps: PlanDeps,
  targetAccountIds: string[],
  groupIds: string[]
): Promise<TransferPlan> {
  const sourceFiles = await deps.source.listFiles(groupIds)

  // Содержимое источника читается один раз на весь план, а не на каждую цель
  const sourceData = new Map<string, { buffer: Buffer; sha1: string }>()
  for (const file of sourceFiles) {
    const buffer = await deps.source.readFile(file.relPath)
    if (buffer) sourceData.set(file.relPath, { buffer, sha1: sha1OfBuffer(buffer) })
  }

  const targets: TargetPlan[] = []

  for (const accountId of targetAccountIds) {
    const targetDir = gameDir(deps.userdataPath, accountId, deps.profile.appId)
    const files: PlannedFile[] = []
    const counts = { ...EMPTY_COUNTS }

    for (const file of sourceFiles) {
      const source = sourceData.get(file.relPath)
      const targetPath = resolveInside(targetDir, file.relPath)
      const targetStat = await statFile(targetPath)
      const targetSha1 = targetStat ? await sha1OfFile(targetPath) : null

      let action: FileAction
      if (!source) action = 'missing-source'
      else if (!targetStat) action = 'add'
      else if (targetSha1 === source.sha1) action = 'identical'
      else action = 'overwrite'

      counts[action]++
      files.push({
        relPath: file.relPath,
        groupId: file.groupId,
        action,
        sourceSize: source?.buffer.byteLength ?? null,
        sourceSha1: source?.sha1 ?? null,
        targetSize: targetStat?.size ?? null,
        targetSha1,
        cloudSynced: isCloudSynced(file.relPath)
      })
    }

    targets.push({ accountId, label: deps.accountLabelOf(accountId), files, counts })
  }

  return {
    appId: deps.profile.appId,
    appName: deps.profile.name,
    source: deps.sourceKind,
    sourceLabel: deps.source.label,
    groupIds,
    targets,
    createdAt: Date.now()
  }
}

/** Файлы, которые реально будут записаны. identical и missing-source пропускаем. */
export function filesToWrite(target: TargetPlan): PlannedFile[] {
  return target.files.filter((f) => f.action === 'add' || f.action === 'overwrite')
}

export function planHasWork(plan: TransferPlan): boolean {
  return plan.targets.some((target) => filesToWrite(target).length > 0)
}
