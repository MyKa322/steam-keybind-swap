import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  isCloudSynced,
  patchRemoteCache,
  readRemoteCacheEntry,
  removeRemoteCacheEntries,
  toRemoteCacheKey
} from '../src/main/steam/remotecache'
import { parseKeyValues, stringifyKeyValues } from '../src/main/steam/vdf'

const FIXTURE = path.join(__dirname, 'fixtures', 'remotecache.vdf')

describe('манифест Steam Cloud', () => {
  let gameDir: string

  beforeEach(() => {
    gameDir = mkdtempSync(path.join(tmpdir(), 'kbswap-'))
    copyFileSync(FIXTURE, path.join(gameDir, 'remotecache.vdf'))
  })

  afterEach(() => {
    rmSync(gameDir, { recursive: true, force: true })
  })

  it('определяет облачные файлы по префиксу remote/', () => {
    expect(isCloudSynced('remote/cfg/chat.cfg')).toBe(true)
    expect(isCloudSynced('local/cfg/video.txt')).toBe(false)
    expect(toRemoteCacheKey('remote/cfg/dotakeys_personal.lst')).toBe('cfg/dotakeys_personal.lst')
    expect(toRemoteCacheKey('local/cfg/video.txt')).toBeNull()
  })

  it('обновляет размер, контрольную сумму и время существующей записи', async () => {
    const before = await readRemoteCacheEntry(gameDir, '570', 'cfg/chat.cfg')
    expect(before).not.toBeNull()

    const outcome = await patchRemoteCache(gameDir, '570', [
      { relPathInRemote: 'cfg/chat.cfg', size: 4242, sha1: 'a'.repeat(40), mtimeSeconds: 1900000000 }
    ])

    expect(outcome.patched).toBe(1)
    const after = await readRemoteCacheEntry(gameDir, '570', 'cfg/chat.cfg')
    expect(after?.size).toBe('4242')
    expect(after?.sha).toBe('a'.repeat(40))
    expect(after?.localtime).toBe('1900000000')
    expect(after?.time).toBe('1900000000')
    expect(after?.syncstate).toBe('1')
  })

  it('оставляет remotetime прежним, чтобы локальная копия выглядела свежее облачной', async () => {
    const before = await readRemoteCacheEntry(gameDir, '570', 'cfg/chat.cfg')

    await patchRemoteCache(gameDir, '570', [
      { relPathInRemote: 'cfg/chat.cfg', size: 10, sha1: 'b'.repeat(40), mtimeSeconds: 1900000000 }
    ])

    const after = await readRemoteCacheEntry(gameDir, '570', 'cfg/chat.cfg')
    expect(after?.remotetime).toBe(before?.remotetime)
    expect(Number(after?.time)).toBeGreaterThan(Number(after?.remotetime))
  })

  it('создаёт запись для файла, которого в манифесте не было', async () => {
    expect(await readRemoteCacheEntry(gameDir, '570', 'cfg/brand_new.cfg')).toBeNull()

    await patchRemoteCache(gameDir, '570', [
      { relPathInRemote: 'cfg/brand_new.cfg', size: 7, sha1: 'c'.repeat(40), mtimeSeconds: 1900000001 }
    ])

    const entry = await readRemoteCacheEntry(gameDir, '570', 'cfg/brand_new.cfg')
    expect(entry).toMatchObject({
      size: '7',
      sha: 'c'.repeat(40),
      // Записи не было — значит на сервере файла тоже нет
      remotetime: '0',
      syncstate: '1'
    })
    // Служебные поля берутся у соседей, чтобы запись выглядела как родная
    expect(entry?.root).toBeDefined()
    expect(entry?.platformstosync2).toBeDefined()
  })

  it('не трогает остальные записи манифеста', async () => {
    const original = parseKeyValues(readFileSync(FIXTURE, 'utf8'))
    const originalCount = (original[0].value as unknown[]).length

    await patchRemoteCache(gameDir, '570', [
      { relPathInRemote: 'cfg/chat.cfg', size: 1, sha1: 'd'.repeat(40), mtimeSeconds: 1 }
    ])

    const patched = parseKeyValues(readFileSync(path.join(gameDir, 'remotecache.vdf'), 'utf8'))
    expect((patched[0].value as unknown[]).length).toBe(originalCount)
    expect(await readRemoteCacheEntry(gameDir, '570', 'cfg/herobuilds.cfg')).toBeTruthy()
  })

  it('удаляет записи при откате', async () => {
    await patchRemoteCache(gameDir, '570', [
      { relPathInRemote: 'cfg/temp.cfg', size: 1, sha1: 'e'.repeat(40), mtimeSeconds: 1 }
    ])
    expect(await readRemoteCacheEntry(gameDir, '570', 'cfg/temp.cfg')).toBeTruthy()

    const outcome = await removeRemoteCacheEntries(gameDir, '570', ['cfg/temp.cfg'])
    expect(outcome.patched).toBe(1)
    expect(await readRemoteCacheEntry(gameDir, '570', 'cfg/temp.cfg')).toBeNull()
  })

  it('сообщает об отсутствии манифеста, а не падает', async () => {
    rmSync(path.join(gameDir, 'remotecache.vdf'))
    const outcome = await patchRemoteCache(gameDir, '570', [
      { relPathInRemote: 'cfg/chat.cfg', size: 1, sha1: 'f'.repeat(40), mtimeSeconds: 1 }
    ])
    expect(outcome).toEqual({ patched: 0, missing: true })
  })

  it('после правки файл остаётся валидным KeyValues', async () => {
    await patchRemoteCache(gameDir, '570', [
      { relPathInRemote: 'cfg/chat.cfg', size: 5, sha1: '0'.repeat(40), mtimeSeconds: 123 }
    ])
    const text = readFileSync(path.join(gameDir, 'remotecache.vdf'), 'utf8')
    expect(stringifyKeyValues(parseKeyValues(text))).toBe(text)
  })

  it('отказывается работать с манифестом чужого приложения', async () => {
    writeFileSync(path.join(gameDir, 'remotecache.vdf'), '"ChangeNumber"\t\t"1"\n')
    await expect(
      patchRemoteCache(gameDir, '570', [
        { relPathInRemote: 'cfg/chat.cfg', size: 1, sha1: '1'.repeat(40), mtimeSeconds: 1 }
      ])
    ).rejects.toThrow(/блока приложения/)
  })
})
