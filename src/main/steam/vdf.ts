/**
 * Парсер и сериализатор Valve KeyValues (.vdf / .vcfg / .lst / .cfg).
 *
 * Почему свой, а не библиотека из npm: мы переписываем remotecache.vdf — файл,
 * который читает сам клиент Steam. Любая потеря табов, порядка ключей или
 * искажение экранирования сломает синхронизацию с облаком.
 *
 * Ключевая особенность формата, проверенная на реальных файлах Dota 2:
 * ЭКРАНИРОВАНИЕ НЕ ПРИМЕНЯЕТСЯ. Бинд на клавишу «\» записан как `"\"` —
 * то есть кавычка, обратный слэш, кавычка. Парсер с поддержкой `\"` на таком
 * файле развалится, поэтому строка в кавычках читается просто до следующей
 * кавычки.
 *
 * Формат вывода (сверен побайтово с user_keys.vcfg):
 *   - перевод строки LF, без CR
 *   - отступ табами по глубине
 *   - лист: "ключ"<TAB><TAB>"значение"
 *   - завершающий LF в конце файла
 */

/** Значение: либо строка-лист, либо вложенный блок. */
export type KvValue = string | KvObject

export interface KvEntry {
  key: string
  value: KvValue
}

/**
 * Блок KeyValues — упорядоченный список пар. Именно массив, а не Map:
 * Valve допускает повторяющиеся ключи, а порядок в файле имеет значение.
 */
export type KvObject = KvEntry[]

export function isKvObject(value: KvValue): value is KvObject {
  return Array.isArray(value)
}

const WHITESPACE = /\s/
const TOKEN_BREAK = /[\s{}"]/

function isTokenBreak(ch: string): boolean {
  return TOKEN_BREAK.test(ch)
}

class Cursor {
  constructor(
    readonly text: string,
    public pos = 0
  ) {}

  /**
   * Пропускает пробельные символы и комментарии `//`.
   *
   * Набор пробельных символов здесь обязан совпадать с тем, по которому
   * обрывается токен без кавычек (WHITESPACE ниже). Пока они расходились,
   * символ вроде \v останавливал чтение токена, но не пропускался тут —
   * и разбор зацикливался на месте.
   */
  skipTrivia(): void {
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos]
      if (WHITESPACE.test(ch)) {
        this.pos++
      } else if (ch === '/' && this.text[this.pos + 1] === '/') {
        while (this.pos < this.text.length && this.text[this.pos] !== '\n') this.pos++
      } else {
        return
      }
    }
  }

  peek(): string | null {
    this.skipTrivia()
    return this.pos < this.text.length ? this.text[this.pos] : null
  }

  /**
   * Читает следующий токен. Строка в кавычках заканчивается на ближайшей
   * кавычке — без разбора escape-последовательностей (см. комментарий к модулю).
   */
  readToken(): string | null {
    this.skipTrivia()
    if (this.pos >= this.text.length) return null

    const ch = this.text[this.pos]
    if (ch === '{' || ch === '}') {
      this.pos++
      return ch
    }

    if (ch === '"') {
      this.pos++
      const start = this.pos
      const end = this.text.indexOf('"', start)
      if (end === -1) {
        this.pos = this.text.length
        return this.text.slice(start)
      }
      this.pos = end + 1
      return this.text.slice(start, end)
    }

    // Токен без кавычек — Valve это допускает.
    const start = this.pos
    while (this.pos < this.text.length && !isTokenBreak(this.text[this.pos])) this.pos++

    // Страховка от вечного цикла: если ни один символ не прочитан, значит на
    // входе что-то, чего разбор не ожидал (например, двоичный файл). Двигаемся
    // на символ вперёд, чтобы разбор всегда завершался.
    if (this.pos === start) {
      this.pos++
      return this.text.slice(start, this.pos)
    }
    return this.text.slice(start, this.pos)
  }
}

/**
 * Разбирает текст KeyValues. Токен `{`/`}` в позиции ключа считается частью
 * структуры, а не ключом, поэтому строки вида `"a" { ... }` читаются корректно.
 */
export function parseKeyValues(text: string): KvObject {
  const cursor = new Cursor(stripBom(text))
  return parseBlock(cursor, true)
}

function parseBlock(cursor: Cursor, isRoot: boolean): KvObject {
  const entries: KvObject = []

  for (;;) {
    const next = cursor.peek()
    if (next === null) {
      if (!isRoot) break // незакрытый блок — не роняем разбор, отдаём что есть
      break
    }
    if (next === '}') {
      cursor.readToken()
      if (isRoot) continue // лишняя закрывающая скобка на верхнем уровне — игнорируем
      break
    }

    const key = cursor.readToken()
    if (key === null) break
    if (key === '{') continue // блок без ключа — пропускаем открывающую скобку

    const after = cursor.peek()
    if (after === '{') {
      cursor.readToken()
      entries.push({ key, value: parseBlock(cursor, false) })
    } else {
      const value = cursor.readToken()
      entries.push({ key, value: value ?? '' })
    }
  }

  return entries
}

/** Сериализует блок обратно в текст в точном формате Steam. */
export function stringifyKeyValues(root: KvObject): string {
  const out: string[] = []
  writeBlock(root, 0, out)
  return out.join('')
}

function writeBlock(obj: KvObject, depth: number, out: string[]): void {
  const indent = '\t'.repeat(depth)
  for (const entry of obj) {
    if (isKvObject(entry.value)) {
      out.push(`${indent}"${entry.key}"\n${indent}{\n`)
      writeBlock(entry.value, depth + 1, out)
      out.push(`${indent}}\n`)
    } else {
      out.push(`${indent}"${entry.key}"\t\t"${entry.value}"\n`)
    }
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

// --- Утилиты доступа -------------------------------------------------------

/** Первое значение по ключу (регистр игнорируется — как в самом Valve KeyValues). */
export function kvFind(obj: KvObject, key: string): KvValue | undefined {
  const lower = key.toLowerCase()
  return obj.find((e) => e.key.toLowerCase() === lower)?.value
}

export function kvFindObject(obj: KvObject, key: string): KvObject | undefined {
  const value = kvFind(obj, key)
  return value !== undefined && isKvObject(value) ? value : undefined
}

export function kvFindString(obj: KvObject, key: string): string | undefined {
  const value = kvFind(obj, key)
  return typeof value === 'string' ? value : undefined
}

/** Заменяет значение первого совпадения либо добавляет новую пару в конец. */
export function kvSet(obj: KvObject, key: string, value: KvValue): void {
  const lower = key.toLowerCase()
  const existing = obj.find((e) => e.key.toLowerCase() === lower)
  if (existing) existing.value = value
  else obj.push({ key, value })
}

/**
 * Разворачивает дерево в плоскую карту `путь/через/точку -> значение`.
 * Используется для diff и для чтения настроек.
 */
export function kvFlatten(obj: KvObject, prefix = ''): Map<string, string> {
  const result = new Map<string, string>()
  walk(obj, prefix, result)
  return result
}

function walk(obj: KvObject, prefix: string, out: Map<string, string>): void {
  for (const entry of obj) {
    const path = prefix ? `${prefix}.${entry.key}` : entry.key
    if (isKvObject(entry.value)) {
      if (entry.value.length === 0) out.set(path, '')
      else walk(entry.value, path, out)
    } else {
      out.set(path, entry.value)
    }
  }
}
