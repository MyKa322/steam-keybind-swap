import { beforeEach, describe, expect, it } from 'vitest'
import type { TransferPlan } from '../src/shared/types'
import { useApp } from '../src/renderer/src/store/app'

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

  it('устаревший план применить нельзя', async () => {
    useApp.setState({ planStale: true })
    await useApp.getState().apply()

    // Ни applyResult, ни попытки записи: apply вышел до обращения к main
    expect(useApp.getState().applyResult).toBeNull()
    expect(useApp.getState().applying).toBe(false)
  })
})
