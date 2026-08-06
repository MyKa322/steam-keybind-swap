import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isKvObject,
  kvFindObject,
  kvFindString,
  kvFlatten,
  parseKeyValues,
  stringifyKeyValues
} from '../src/main/steam/vdf'

/**
 * Фикстуры — настоящие файлы из установки Steam, а не придуманные примеры.
 * Именно на них проверяется главное свойство парсера: прочитать и записать
 * обратно байт в байт. Мы переписываем remotecache.vdf, который читает сам
 * клиент Steam, поэтому «почти такой же» результат не годится.
 */
const fixture = (name: string): string =>
  readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')

describe('парсер KeyValues', () => {
  it('читает и записывает user_keys.vcfg байт в байт', () => {
    const text = fixture('user_keys.vcfg')
    expect(stringifyKeyValues(parseKeyValues(text))).toBe(text)
  })

  it('читает и записывает dotakeys_personal.lst байт в байт', () => {
    const text = fixture('dotakeys_personal.lst')
    expect(stringifyKeyValues(parseKeyValues(text))).toBe(text)
  })

  it('читает и записывает remotecache.vdf байт в байт', () => {
    const text = fixture('remotecache.vdf')
    expect(stringifyKeyValues(parseKeyValues(text))).toBe(text)
  })

  it('завершает разбор двоичного файла, а не зацикливается', () => {
    // chat.cfg в Dota 2 записан в двоичном формате Valve (сигнатура VBKV).
    // Осмысленного результата тут быть не может, важно другое: разбор обязан
    // завершиться. Раньше на таком вводе позиция переставала двигаться и
    // процесс уходил в вечный цикл, съедая память.
    const binary = readFileSync(path.join(__dirname, 'fixtures', 'chat.cfg')).toString('utf8')
    expect(binary.startsWith('VBKV')).toBe(true)
    expect(() => parseKeyValues(binary)).not.toThrow()
  })

  it('завершает разбор произвольного мусора', () => {
    const junk = Array.from({ length: 500 }, (_, i) => String.fromCharCode(i % 65535)).join('')
    expect(() => parseKeyValues(junk)).not.toThrow()
  })

  it('не ломается на бинде обратного слэша', () => {
    // Клавиша «\» записана Valve как "\" — без экранирования. Парсер с
    // поддержкой \" прочитал бы это как незакрытую строку и развалил файл.
    const bindings = kvFindObject(parseKeyValues(fixture('user_keys.vcfg')), 'config')
    const keys = bindings ? kvFindObject(bindings, 'bindings') : undefined

    expect(keys).toBeDefined()
    expect(kvFindString(keys!, '\\')).toBe('toggleconsole')
    expect(kvFindString(keys!, 'F11')).toBe('hud_toggle_visibility')
  })

  it('сохраняет порядок и повторяющиеся ключи', () => {
    const parsed = parseKeyValues('"root"\n{\n\t"a"\t\t"1"\n\t"a"\t\t"2"\n\t"b"\t\t"3"\n}\n')
    const root = kvFindObject(parsed, 'root')!
    expect(root.map((entry) => [entry.key, entry.value])).toEqual([
      ['a', '1'],
      ['a', '2'],
      ['b', '3']
    ])
  })

  it('разбирает раскладку Dota 2 в плоские пути', () => {
    const flat = kvFlatten(parseKeyValues(fixture('dotakeys_personal.lst')))

    expect(flat.get('KeyBindings.Name')).toBe('ARROW')
    expect(flat.get('KeyBindings.Keys.CameraUp.Key')).toBe('UPARROW')
    expect(flat.get('KeyBindings.Keys.ScoreboardToggle.Key')).toBe('`')
    // Действий в файле полторы сотни — проверяем, что дерево развернулось целиком
    expect([...flat.keys()].filter((key) => key.endsWith('.Key')).length).toBeGreaterThan(100)
  })

  it('игнорирует комментарии и токены без кавычек', () => {
    const parsed = parseKeyValues('// шапка\n"root"\n{\n\tkey value // хвост\n}\n')
    const root = kvFindObject(parsed, 'root')!
    expect(kvFindString(root, 'key')).toBe('value')
  })

  it('не падает на незакрытом блоке', () => {
    const parsed = parseKeyValues('"root"\n{\n\t"a"\t\t"1"\n')
    const root = kvFindObject(parsed, 'root')
    expect(root && isKvObject(root)).toBe(true)
    expect(kvFindString(root!, 'a')).toBe('1')
  })
})
