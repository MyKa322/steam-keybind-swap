import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildDiff } from '../src/main/transfer/diff'

const fixture = (name: string): Buffer => readFileSync(path.join(__dirname, 'fixtures', name))

describe('сравнение конфигов', () => {
  it('показывает изменение бинда как одну понятную строку', () => {
    const before = Buffer.from(
      '"KeyBindings"\n{\n\t"Keys"\n\t{\n\t\t"HeroAttack"\n\t\t{\n\t\t\t"Key"\t\t"A"\n\t\t}\n\t}\n}\n'
    )
    const after = Buffer.from(
      '"KeyBindings"\n{\n\t"Keys"\n\t{\n\t\t"HeroAttack"\n\t\t{\n\t\t\t"Key"\t\t"Q"\n\t\t}\n\t}\n}\n'
    )

    const diff = buildDiff('remote/cfg/dotakeys_personal.lst', after, before)

    expect(diff.kind).toBe('keyvalues')
    expect(diff.rows).toEqual([
      {
        key: 'HeroAttack.Key',
        labelKey: 'bind.HeroAttack',
        fieldKey: 'field.key',
        before: 'A',
        after: 'Q',
        status: 'changed'
      }
    ])
  })

  it('различает добавленное, удалённое и совпадающее', () => {
    const target = Buffer.from('"config"\n{\n\t"convars"\n\t{\n\t\t"a"\t\t"1"\n\t\t"b"\t\t"2"\n\t}\n}\n')
    const source = Buffer.from('"config"\n{\n\t"convars"\n\t{\n\t\t"a"\t\t"1"\n\t\t"c"\t\t"3"\n\t}\n}\n')

    const diff = buildDiff('remote/user_convars.vcfg', source, target)

    expect(diff.counts).toEqual({ same: 1, added: 1, removed: 1, changed: 0 })
    // Строки идут по алфавиту ключа, а совпадающие в таблицу не попадают —
    // их сотни на каждый файл
    expect(diff.rows.map((row) => [row.key, row.status])).toEqual([
      ['convars.b', 'removed'],
      ['convars.c', 'added']
    ])
  })

  it('разбирает настоящий файл раскладки Dota 2', () => {
    const original = fixture('dotakeys_personal.lst')
    const modified = Buffer.from(
      original.toString('utf8').replace('"Key"\t\t"UPARROW"', '"Key"\t\t"W"'),
      'utf8'
    )

    const diff = buildDiff('remote/cfg/dotakeys_personal.lst', modified, original)

    expect(diff.rows).toHaveLength(1)
    expect(diff.rows[0]).toMatchObject({
      key: 'CameraUp.Key',
      labelKey: 'bind.CameraUp',
      before: 'UPARROW',
      after: 'W'
    })
    expect(diff.counts.same).toBeGreaterThan(100)
  })

  it('помечает двоичный файл как несравнимый', () => {
    const binary = Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff])
    const diff = buildDiff('remote/teams/logo_1', binary, binary)

    expect(diff.kind).toBe('opaque')
    expect(diff.noteKey).toBe('diff.note.opaque')
    expect(diff.rows).toEqual([])
  })

  it('сравнивает json по путям внутри структуры', () => {
    const target = Buffer.from(JSON.stringify({ configs: [{ name: 'Старая' }] }))
    const source = Buffer.from(JSON.stringify({ configs: [{ name: 'Новая' }] }))

    const diff = buildDiff('remote/cfg/hero_grid_config.json', source, target)

    expect(diff.kind).toBe('json')
    expect(diff.rows[0]).toMatchObject({
      key: 'configs[0].name',
      before: 'Старая',
      after: 'Новая',
      status: 'changed'
    })
  })

  it('считает файл, которого нет у получателя, полностью добавленным', () => {
    const diff = buildDiff('remote/cfg/dotakeys_personal.lst', fixture('dotakeys_personal.lst'), null)

    expect(diff.counts.removed).toBe(0)
    expect(diff.counts.added).toBeGreaterThan(100)
    expect(diff.rows.every((row) => row.status === 'added')).toBe(true)
  })

  it('распознаёт двоичный chat.cfg как несравнимый', () => {
    // В Dota 2 chat.cfg записан не текстом, а в двоичном формате Valve (VBKV).
    // Расширение .cfg тут обманчиво, поэтому решает проверка содержимого.
    const diff = buildDiff('remote/cfg/chat.cfg', fixture('chat.cfg'), fixture('chat.cfg'))

    expect(diff.kind).toBe('opaque')
    expect(diff.noteKey).toBe('diff.note.opaque')
  })
})
