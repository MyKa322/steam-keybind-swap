import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gameDir, isSafeRelPath, resolveInside, steamId64ToAccountId, accountIdToSteamId64 } from '../src/main/steam/paths'
import { matchesAny, selectFiles } from '../src/main/games/registry'
import { dota2Profile } from '../src/main/games/dota2'
import { cs2Profile } from '../src/main/games/cs2'
import { readBundle } from '../src/main/bundle/bundle'
import { preflight } from '../src/main/steam/process'
import { describeFsError } from '../src/main/fsutil'

describe('преобразование идентификаторов Steam', () => {
  it('переводит SteamID64 в имя папки userdata и обратно', () => {
    // Смещение 76561197960265728 — константа Valve, одинаковая для всех.
    // Значения ниже синтетические: привязывать тесты к чьему-то настоящему
    // аккаунту незачем, а в публичном репозитории ещё и не нужно.
    expect(steamId64ToAccountId('76561197960265729')).toBe('1')
    expect(accountIdToSteamId64('1')).toBe('76561197960265729')

    expect(steamId64ToAccountId('76561198000000000')).toBe('39734272')
    expect(accountIdToSteamId64('39734272')).toBe('76561198000000000')
  })

  it('переживает круговое преобразование для больших идентификаторов', () => {
    // AccountID выходит за пределы 32-битного знакового int, поэтому внутри
    // используется BigInt — обычные числа тут теряют точность
    for (const accountId of ['1', '39734272', '1234567890', '4294967295']) {
      expect(steamId64ToAccountId(accountIdToSteamId64(accountId))).toBe(accountId)
    }
  })
})

describe('безопасность путей', () => {
  it('отклоняет выход вверх, абсолютные пути и диски', () => {
    for (const bad of [
      '../secrets.txt',
      'remote/../../other/file.cfg',
      '/etc/passwd',
      'C:/Windows/system32/drivers/etc/hosts',
      '\\\\server\\share\\file',
      'remote//cfg/chat.cfg',
      '',
      'remote/cfg/\0evil'
    ]) {
      expect(isSafeRelPath(bad), bad).toBe(false)
    }
  })

  it('пропускает обычные относительные пути', () => {
    expect(isSafeRelPath('remote/cfg/dotakeys_personal.lst')).toBe(true)
    expect(isSafeRelPath('local/cfg/user_keys_0_slot0.vcfg')).toBe(true)
  })

  it('не даёт resolveInside выбраться из папки игры', () => {
    expect(() => resolveInside('C:/steam/userdata/1/570', '../../../evil.txt')).toThrow()
    expect(resolveInside('C:/steam/userdata/1/570', 'remote/cfg/chat.cfg')).toContain('chat.cfg')
  })

  it('проверяет, что идентификаторы аккаунта и игры числовые', () => {
    expect(() => gameDir('C:/steam/userdata', '../evil', '570')).toThrow()
    expect(() => gameDir('C:/steam/userdata', '123', 'notanumber')).toThrow()
    expect(gameDir('C:/steam/userdata', '123', '570')).toContain('570')
  })
})

describe('отбор файлов по профилю', () => {
  it('не путает конфиг со служебной копией Steam', () => {
    // *_lastclouded — слепок последней синхронизации. Он лежит рядом с конфигом
    // и отличается только суффиксом, поэтому шаблон обязан якориться с конца.
    const files = [
      'local/cfg/user_keys_0_slot0.vcfg',
      'local/cfg/user_keys_0_slot0.vcfg_lastclouded',
      'local/cfg/video_tools.txt.bak'
    ]
    const selected = selectFiles(files, dota2Profile, ['keys', 'video']).map((f) => f.relPath)

    expect(selected).toContain('local/cfg/user_keys_0_slot0.vcfg')
    expect(selected).not.toContain('local/cfg/user_keys_0_slot0.vcfg_lastclouded')
    expect(selected).not.toContain('local/cfg/video_tools.txt.bak')
  })

  it('не копирует данные, привязанные к личности аккаунта', () => {
    const files = [
      'remote/cfg/dotakeys_personal.lst',
      'remote/cfg/stats.dat',
      'remote/cfg/last_match.dat',
      'remote/teams/logo_9785393',
      'remote/scripts/dota_acknowledged_violators.txt',
      'remotecache.vdf'
    ]
    const allGroups = dota2Profile.groups.map((g) => g.id)
    const selected = selectFiles(files, dota2Profile, allGroups).map((f) => f.relPath)

    expect(selected).toEqual(['remote/cfg/dotakeys_personal.lst'])
  })

  it('раскрывает * только внутри одного сегмента пути', () => {
    expect(matchesAny('remote/guides/pudge_1.build', ['remote/guides/*.build'])).toBe(true)
    expect(matchesAny('remote/guides/nested/deep.build', ['remote/guides/*.build'])).toBe(false)
  })

  it('берёт файлы только выбранных групп', () => {
    const files = ['remote/cs2_user_keys.vcfg', 'remote/cs2_user_convars.vcfg']
    expect(selectFiles(files, cs2Profile, ['keys']).map((f) => f.relPath)).toEqual([
      'remote/cs2_user_keys.vcfg'
    ])
  })
})

describe('проверка перед переносом', () => {
  it.runIf(process.platform === 'win32')('получает список процессов через tasklist', async () => {
    const result = await preflight(['dota2.exe'])

    // Если список процессов получить не удалось, приложение обязано сказать об
    // этом честно, а не сделать вид, что всё закрыто
    expect(result.checked).toBe(true)
    expect(typeof result.steamRunning).toBe('boolean')
    expect(Array.isArray(result.processNames)).toBe(true)
  })
})

describe('описание ошибок файловой системы', () => {
  it('объясняет нехватку прав понятным языком', () => {
    const error = Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
    const message = describeFsError(error, 'C:/steam/userdata/1/570/remote/user_keys.vcfg')

    expect(message).toContain('user_keys.vcfg')
    expect(message).toContain('администратора')
  })

  it('различает занятый файл и переполненный диск', () => {
    expect(describeFsError({ code: 'EBUSY' }, 'a/b/chat.cfg')).toContain('занят')
    expect(describeFsError({ code: 'ENOSPC' }, 'a/b/chat.cfg')).toContain('места')
  })

  it('не теряет незнакомую ошибку', () => {
    expect(describeFsError(new Error('что-то своё'), 'a/b/c')).toBe('что-то своё')
  })
})

describe('чтение недоверенного файла .d2keys', () => {
  let dir: string
  const write = (name: string, data: unknown): string => {
    const filePath = path.join(dir, name)
    writeFileSync(filePath, typeof data === 'string' ? data : JSON.stringify(data))
    return filePath
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'kbswap-bundle-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const valid = {
    formatVersion: 1,
    appId: '570',
    appName: 'Dota 2',
    createdAt: 1,
    sourceLabel: null,
    groupIds: ['keys'],
    files: [
      {
        relPath: 'remote/cfg/chat.cfg',
        // sha1 от строки "hello"
        sha1: 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d',
        size: 5,
        encoding: 'utf8',
        content: 'hello'
      }
    ]
  }

  it('читает корректный файл', async () => {
    const manifest = await readBundle(write('ok.d2keys', valid))
    expect(manifest.files[0].relPath).toBe('remote/cfg/chat.cfg')
  })

  it('отклоняет путь с выходом вверх', async () => {
    const evil = structuredClone(valid)
    evil.files[0].relPath = '../../../AppData/Roaming/evil.exe'
    await expect(readBundle(write('evil.d2keys', evil))).rejects.toThrow(/Небезопасный путь/)
  })

  it('отклоняет абсолютный путь', async () => {
    const evil = structuredClone(valid)
    evil.files[0].relPath = 'C:/Windows/system32/evil.dll'
    await expect(readBundle(write('abs.d2keys', evil))).rejects.toThrow(/Небезопасный путь/)
  })

  it('отклоняет подменённое содержимое', async () => {
    const tampered = structuredClone(valid)
    tampered.files[0].content = 'подменено'
    await expect(readBundle(write('tampered.d2keys', tampered))).rejects.toThrow(
      /Контрольная сумма/
    )
  })

  it('отклоняет неизвестную версию формата', async () => {
    const future = { ...structuredClone(valid), formatVersion: 99 }
    await expect(readBundle(write('future.d2keys', future))).rejects.toThrow(/версия формата/)
  })

  it('отклоняет мусор вместо JSON', async () => {
    await expect(readBundle(write('junk.d2keys', 'не json'))).rejects.toThrow(/JSON/)
  })
})
