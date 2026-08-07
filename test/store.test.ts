import { beforeEach, describe, expect, it } from 'vitest'
import type { AppSettings, SteamAccount, TransferPlan } from '../src/shared/types'
import { useApp } from '../src/renderer/src/store/app'

const account = (accountId: string): SteamAccount => ({
  accountId,
  steamId64: `7656${accountId}`,
  accountName: null,
  personaName: `Аккаунт ${accountId}`,
  avatarDataUrl: null,
  lastLogin: null,
  isAutoLogin: false,
  games: [{ appId: '570', name: 'Dota 2', known: true, fileCount: 5, lastModified: null }]
})

const settingsWith = (lastSourceAccountId: string | null): AppSettings => ({
  language: 'ru',
  steamPathOverride: null,
  patchRemoteCache: true,
  allowWhenSteamRunning: false,
  includeAccountNameInExport: true,
  lastAppId: '570',
  lastSourceAccountId
})

/** Подменяет ответ моста preload на список аккаунтов. */
function stubAccounts(accounts: SteamAccount[]): void {
  const api = (globalThis as unknown as { window: { api: Record<string, unknown> } }).window.api
  api.accounts = { list: () => Promise.resolve({ ok: true, value: accounts }) }
}

/**
 * Защита от возврата бага с «улетающим» интерфейсом.
 *
 * Раньше любое изменение выбора обнуляло план. Блок предпросмотра исчезал из
 * разметки, страница укорачивалась на полторы тысячи пикселей, и браузер
 * прижимал прокрутку к новому максимуму — пользователя выбрасывало из списка
 * файлов, который он читал. Правильное поведение: план остаётся на месте и
 * помечается устаревшим.
 */

const plan = {
  appId: '570',
  appName: 'Dota 2',
  source: { kind: 'account', accountId: '1' },
  sourceLabel: 'Источник',
  groupIds: ['keys'],
  createdAt: 0,
  targets: [
    {
      accountId: '2',
      label: 'Получатель',
      files: [],
      counts: { add: 1, overwrite: 0, identical: 0, 'missing-source': 0 }
    }
  ]
} satisfies TransferPlan

describe('состояние плана переноса', () => {
  beforeEach(() => {
    // Часть действий попутно сохраняет выбор через мост preload. Тест
    // выполняется в Node, где нет ни window, ни моста, поэтому подставляем
    // заглушку — проверяется состояние стора, а не обмен с main-процессом.
    const noop = (): Promise<{ ok: true; value: null }> => Promise.resolve({ ok: true, value: null })
    Object.defineProperty(globalThis, 'window', {
      value: { api: { settings: { set: noop }, transfer: { apply: noop } } },
      writable: true,
      configurable: true
    })

    useApp.setState({
      plan,
      planStale: false,
      appId: '570',
      groupIds: ['keys', 'settings'],
      targetIds: ['2', '3'],
      sourceAccountId: '1',
      bundle: null,
      accounts: [],
      games: []
    })
  })

  it('снятие галочки с группы не выбрасывает план, а помечает его устаревшим', () => {
    useApp.getState().toggleGroup('keys')

    expect(useApp.getState().plan).not.toBeNull()
    expect(useApp.getState().planStale).toBe(true)
  })

  it('изменение списка получателей тоже только помечает план', () => {
    useApp.getState().toggleTarget('3')

    expect(useApp.getState().plan).not.toBeNull()
    expect(useApp.getState().planStale).toBe(true)
  })

  it('смена источника только помечает план', () => {
    useApp.getState().setSourceAccount('9')

    expect(useApp.getState().plan).not.toBeNull()
    expect(useApp.getState().planStale).toBe(true)
  })

  it('не помечает устаревшим, когда плана ещё нет', () => {
    useApp.setState({ plan: null, planStale: false })
    useApp.getState().toggleGroup('keys')

    expect(useApp.getState().planStale).toBe(false)
  })

  it('единственный аккаунт с игрой выбирается источником сам', async () => {
    // Частый случай: человек держит по одному аккаунту за раз и выходит из
    // Steam, чтобы зайти в другой. Выбирать не из чего, а без выбранного
    // источника недоступен экспорт пресета в файл.
    stubAccounts([account('100000001')])
    useApp.setState({ sourceAccountId: null, settings: settingsWith(null) })

    await useApp.getState().refreshAccounts()

    expect(useApp.getState().sourceAccountId).toBe('100000001')
  })

  it('при нескольких аккаунтах источник не угадывается', async () => {
    stubAccounts([account('100000001'), account('100000002')])
    useApp.setState({ sourceAccountId: null, settings: settingsWith(null) })

    await useApp.getState().refreshAccounts()

    expect(useApp.getState().sourceAccountId).toBeNull()
  })

  it('запомненный источник важнее автовыбора', async () => {
    stubAccounts([account('100000001'), account('100000002')])
    useApp.setState({ sourceAccountId: null, settings: settingsWith('100000002') })

    await useApp.getState().refreshAccounts()

    expect(useApp.getState().sourceAccountId).toBe('100000002')
  })

  it('устаревший план применить нельзя', async () => {
    useApp.setState({ planStale: true })
    await useApp.getState().apply()

    // Ни applyResult, ни попытки записи: apply вышел до обращения к main
    expect(useApp.getState().applyResult).toBeNull()
    expect(useApp.getState().applying).toBe(false)
  })
})
