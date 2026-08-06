/**
 * Диагностика на живой установке Steam: прогоняет тот же код, что и приложение,
 * но печатает результат в консоль. Полезно, когда список аккаунтов в интерфейсе
 * выглядит не так, как ожидалось, — сразу видно, что именно нашёл поиск.
 *
 * Запуск: npm run check:steam
 */
import { detectSteam } from '../src/main/steam/paths'
import { listAccounts, accountLabel } from '../src/main/steam/accounts'
import { preflight } from '../src/main/steam/process'
import { listProfiles } from '../src/main/games/registry'
import { createSourceReader } from '../src/main/transfer/source'
import { buildPlan } from '../src/main/transfer/plan'
import { dota2Profile } from '../src/main/games/dota2'

async function main(): Promise<void> {
  const detection = await detectSteam(null)
  console.log('Steam:', detection.location?.path ?? detection.error)
  console.log('Источник пути:', detection.location?.source)
  if (!detection.location) return

  for (const profile of listProfiles()) {
    console.log(`Проверка процессов для ${profile.name}:`, await preflight(profile.processNames))
  }

  const accounts = await listAccounts(detection.location)
  console.log(`\nАккаунтов с поддерживаемой игрой: ${accounts.length}`)
  for (const account of accounts) {
    const games = account.games.map((g) => `${g.name}: ${g.fileCount} файлов`).join(', ')
    console.log(
      ` • ${accountLabel(account).padEnd(34)} аватар:${account.avatarDataUrl ? 'да' : 'нет'}  ${games}`
    )
  }

  const dota = accounts.filter((a) => a.games.some((g) => g.appId === '570'))
  if (dota.length < 2) {
    console.log('\nДля проверки плана нужно минимум два аккаунта с Dota 2')
    return
  }

  const [source, ...targets] = dota
  const reader = await createSourceReader(
    { kind: 'account', accountId: source.accountId },
    dota2Profile,
    detection.location.userdataPath,
    (id) => accountLabel(accounts.find((a) => a.accountId === id) ?? ({ accountId: id } as never))
  )

  const plan = await buildPlan(
    {
      userdataPath: detection.location.userdataPath,
      profile: dota2Profile,
      source: reader,
      sourceKind: { kind: 'account', accountId: source.accountId },
      accountLabelOf: (id) =>
        accounts.find((a) => a.accountId === id)?.personaName ?? id
    },
    targets.map((a) => a.accountId),
    ['keys', 'settings', 'controlgroups', 'chat']
  )

  console.log(`\nПлан переноса из «${plan.sourceLabel}» (ничего не записывается):`)
  for (const target of plan.targets) {
    console.log(` → ${target.label}:`, target.counts)
    for (const file of target.files) {
      console.log(`     ${file.action.padEnd(15)} ${file.relPath}`)
    }
  }
}

void main().catch((error) => {
  console.error('Ошибка:', error)
  process.exitCode = 1
})
