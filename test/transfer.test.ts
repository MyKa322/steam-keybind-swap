import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dota2Profile } from '../src/main/games/dota2'
import { buildPlan } from '../src/main/transfer/plan'
import { applyPlan, restore } from '../src/main/transfer/apply'
import { createSourceReader } from '../src/main/transfer/source'
import { listBackups } from '../src/main/transfer/backup'
import { readRemoteCacheEntry } from '../src/main/steam/remotecache'
import { sha1OfFile } from '../src/main/fsutil'
import { buildBundle, readBundle, writeBundle } from '../src/main/bundle/bundle'

/**
 * Сквозной прогон на временной копии структуры userdata: план → бэкап →
 * запись → правка манифеста облака → откат. Проверяется то, ради чего
 * приложение существует, а не отдельные функции.
 */

const SOURCE_ID = '1000000001'
const TARGET_ID = '2000000002'
const KEYS_FILE = 'remote/cfg/dotakeys_personal.lst'
const LOCAL_FILE = 'local/cfg/user_keys_0_slot0.vcfg'

const fixture = (name: string): string => path.join(__dirname, 'fixtures', name)

describe('перенос настроек', () => {
  let root: string
  let userdata: string

  const gameFolder = (accountId: string): string => path.join(userdata, accountId, '570')

  const writeFile = (accountId: string, relPath: string, content: string): void => {
    const full = path.join(gameFolder(accountId), relPath)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
  }

  const readFile = (accountId: string, relPath: string): string =>
    readFileSync(path.join(gameFolder(accountId), relPath), 'utf8')

  const makePlan = async (groupIds = ['keys']) => {
    const source = await createSourceReader(
      { kind: 'account', accountId: SOURCE_ID },
      dota2Profile,
      userdata,
      (id) => `Аккаунт ${id}`
    )
    const plan = await buildPlan(
      {
        userdataPath: userdata,
        profile: dota2Profile,
        source,
        sourceKind: { kind: 'account', accountId: SOURCE_ID },
        accountLabelOf: (id) => `Аккаунт ${id}`
      },
      [TARGET_ID],
      groupIds
    )
    return { plan, source }
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'kbswap-transfer-'))
    userdata = path.join(root, 'userdata')

    // Источник: настоящая раскладка Dota 2 плюс локальный бинд
    mkdirSync(path.join(gameFolder(SOURCE_ID), 'remote', 'cfg'), { recursive: true })
    copyFileSync(fixture('dotakeys_personal.lst'), path.join(gameFolder(SOURCE_ID), KEYS_FILE))
    writeFile(SOURCE_ID, LOCAL_FILE, '"config"\n{\n\t"bindings"\n\t{\n\t\t"f"\t\t"attack"\n\t}\n}\n')

    // Получатель: другая раскладка и настоящий манифест облака
    writeFile(
      TARGET_ID,
      KEYS_FILE,
      '"KeyBindings"\n{\n\t"Keys"\n\t{\n\t\t"HeroAttack"\n\t\t{\n\t\t\t"Key"\t\t"Z"\n\t\t}\n\t}\n}\n'
    )
    copyFileSync(fixture('remotecache.vdf'), path.join(gameFolder(TARGET_ID), 'remotecache.vdf'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('строит план: один файл заменить, другой создать', async () => {
    const { plan } = await makePlan()
    const target = plan.targets[0]

    expect(target.label).toBe(`Аккаунт ${TARGET_ID}`)
    expect(target.files.find((f) => f.relPath === KEYS_FILE)?.action).toBe('overwrite')
    expect(target.files.find((f) => f.relPath === LOCAL_FILE)?.action).toBe('add')
    expect(target.counts.overwrite).toBe(1)
    expect(target.counts.add).toBe(1)
  })

  it('помечает совпадающие файлы и не трогает их', async () => {
    copyFileSync(
      path.join(gameFolder(SOURCE_ID), KEYS_FILE),
      path.join(gameFolder(TARGET_ID), KEYS_FILE)
    )

    const { plan } = await makePlan()
    expect(plan.targets[0].files.find((f) => f.relPath === KEYS_FILE)?.action).toBe('identical')

    const { source } = await makePlan()
    const result = await applyPlan(
      {
        userdataPath: userdata,
        backupsRoot: path.join(root, 'backups'),
        profile: dota2Profile,
        source,
        patchRemoteCacheEnabled: true,
        steamWasRunning: false
      },
      plan
    )

    expect(result.targets[0].files.map((f) => f.relPath)).toEqual([LOCAL_FILE])
  })

  it('копирует файлы и правит манифест облака только для remote/', async () => {
    const { plan, source } = await makePlan()

    const result = await applyPlan(
      {
        userdataPath: userdata,
        backupsRoot: path.join(root, 'backups'),
        profile: dota2Profile,
        source,
        patchRemoteCacheEnabled: true,
        steamWasRunning: false
      },
      plan
    )

    expect(result.targets[0].copiedCount).toBe(2)
    expect(result.targets[0].failedCount).toBe(0)

    // Содержимое совпало побайтово
    expect(await sha1OfFile(path.join(gameFolder(TARGET_ID), KEYS_FILE))).toBe(
      await sha1OfFile(path.join(gameFolder(SOURCE_ID), KEYS_FILE))
    )
    expect(readFile(TARGET_ID, LOCAL_FILE)).toContain('attack')

    // Запись манифеста обновлена под новый файл
    const entry = await readRemoteCacheEntry(gameFolder(TARGET_ID), '570', 'cfg/dotakeys_personal.lst')
    expect(entry?.sha).toBe(await sha1OfFile(path.join(gameFolder(TARGET_ID), KEYS_FILE)))
    expect(entry?.size).toBe(String(readFileSync(path.join(gameFolder(TARGET_ID), KEYS_FILE)).byteLength))

    // Файл из local/ облаком не синхронизируется — записи для него быть не должно
    expect(await readRemoteCacheEntry(gameFolder(TARGET_ID), '570', 'cfg/user_keys_0_slot0.vcfg')).toBeNull()
    expect(result.targets[0].remoteCachePatched).toBe(1)
  })

  it('откат возвращает прежнее содержимое и убирает созданные файлы', async () => {
    const before = readFile(TARGET_ID, KEYS_FILE)
    const { plan, source } = await makePlan()

    const applied = await applyPlan(
      {
        userdataPath: userdata,
        backupsRoot: path.join(root, 'backups'),
        profile: dota2Profile,
        source,
        patchRemoteCacheEnabled: true,
        steamWasRunning: false
      },
      plan
    )
    const backupId = applied.targets[0].backupId!
    expect(readFile(TARGET_ID, KEYS_FILE)).not.toBe(before)

    const result = await restore(
      { userdataPath: userdata, backupsRoot: path.join(root, 'backups'), patchRemoteCacheEnabled: true },
      backupId,
      TARGET_ID,
      '570'
    )

    expect(readFile(TARGET_ID, KEYS_FILE)).toBe(before)
    // Файла, которого у получателя не было, после отката тоже быть не должно
    expect(existsSync(path.join(gameFolder(TARGET_ID), LOCAL_FILE))).toBe(false)
    expect(result.files.find((f) => f.relPath === KEYS_FILE)?.status).toBe('restored')
    expect(result.files.find((f) => f.relPath === LOCAL_FILE)?.status).toBe('removed')
  })

  it('откат не затирает правки, сделанные пользователем после переноса', async () => {
    const { plan, source } = await makePlan()
    const applied = await applyPlan(
      {
        userdataPath: userdata,
        backupsRoot: path.join(root, 'backups'),
        profile: dota2Profile,
        source,
        patchRemoteCacheEnabled: true,
        steamWasRunning: false
      },
      plan
    )

    // Пользователь перенастроил бинды уже после переноса
    writeFile(TARGET_ID, KEYS_FILE, '"KeyBindings"\n{\n\t"Name"\t\t"МОЯ РАСКЛАДКА"\n}\n')

    const result = await restore(
      { userdataPath: userdata, backupsRoot: path.join(root, 'backups'), patchRemoteCacheEnabled: true },
      applied.targets[0].backupId!,
      TARGET_ID,
      '570'
    )

    expect(result.files.find((f) => f.relPath === KEYS_FILE)?.status).toBe('skipped-modified')
    expect(readFile(TARGET_ID, KEYS_FILE)).toContain('МОЯ РАСКЛАДКА')
  })

  it('сохраняет в бэкап исходное содержимое получателя', async () => {
    const before = readFile(TARGET_ID, KEYS_FILE)
    const { plan, source } = await makePlan()

    await applyPlan(
      {
        userdataPath: userdata,
        backupsRoot: path.join(root, 'backups'),
        profile: dota2Profile,
        source,
        patchRemoteCacheEnabled: true,
        steamWasRunning: false
      },
      plan
    )

    const backups = await listBackups(path.join(root, 'backups'))
    expect(backups).toHaveLength(1)
    expect(backups[0].targetAccountId).toBe(TARGET_ID)

    const saved = readFileSync(
      path.join(root, 'backups', backups[0].id, 'files', KEYS_FILE),
      'utf8'
    )
    expect(saved).toBe(before)
    expect(backups[0].files.find((f) => f.relPath === LOCAL_FILE)?.existed).toBe(false)
  })

  it('не пишет файл, если он не входит в выбранные группы', async () => {
    const { plan, source } = await makePlan(['keys'])
    // Имитируем подделанный план: renderer прислал файл из невыбранной группы
    plan.targets[0].files.push({
      relPath: 'local/cfg/trustedlaunch.cfg',
      groupId: 'keys',
      action: 'add',
      sourceSize: 1,
      sourceSha1: null,
      targetSize: null,
      targetSha1: null,
      cloudSynced: false
    })

    const result = await applyPlan(
      {
        userdataPath: userdata,
        backupsRoot: path.join(root, 'backups'),
        profile: dota2Profile,
        source,
        patchRemoteCacheEnabled: true,
        steamWasRunning: false
      },
      plan
    )

    expect(result.targets[0].files.map((f) => f.relPath)).not.toContain('local/cfg/trustedlaunch.cfg')
    expect(existsSync(path.join(gameFolder(TARGET_ID), 'local/cfg/trustedlaunch.cfg'))).toBe(false)
  })

  it('переносит настройки через файл .d2keys', async () => {
    const source = await createSourceReader(
      { kind: 'account', accountId: SOURCE_ID },
      dota2Profile,
      userdata,
      (id) => `Аккаунт ${id}`
    )
    const bundlePath = path.join(root, 'set.d2keys')
    await writeBundle(
      bundlePath,
      await buildBundle({
        appId: '570',
        appName: 'Dota 2',
        sourceLabel: 'Основной',
        groupIds: ['keys'],
        files: await source.listFiles(['keys']),
        readFile: (relPath) => source.readFile(relPath)
      })
    )

    expect((await readBundle(bundlePath)).files.length).toBeGreaterThan(0)

    const bundleSource = await createSourceReader(
      { kind: 'bundle', bundlePath, label: 'Основной' },
      dota2Profile,
      userdata,
      (id) => id
    )
    const plan = await buildPlan(
      {
        userdataPath: userdata,
        profile: dota2Profile,
        source: bundleSource,
        sourceKind: { kind: 'bundle', bundlePath, label: 'Основной' },
        accountLabelOf: (id) => `Аккаунт ${id}`
      },
      [TARGET_ID],
      ['keys']
    )

    await applyPlan(
      {
        userdataPath: userdata,
        backupsRoot: path.join(root, 'backups'),
        profile: dota2Profile,
        source: bundleSource,
        patchRemoteCacheEnabled: true,
        steamWasRunning: false
      },
      plan
    )

    expect(await sha1OfFile(path.join(gameFolder(TARGET_ID), KEYS_FILE))).toBe(
      await sha1OfFile(path.join(gameFolder(SOURCE_ID), KEYS_FILE))
    )
  })
})
