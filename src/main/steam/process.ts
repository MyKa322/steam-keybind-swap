import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import type { PreflightResult } from '@shared/types'

const execFileAsync = promisify(execFile)

const STEAM_PROCESSES = ['steam.exe', 'steamwebhelper.exe', 'steamservice.exe']

/**
 * Полный путь к системной утилите вместо голого имени.
 *
 * Поиск по PATH подвержен двум бедам сразу: на чужой машине PATH может быть
 * сломан, а посторонний tasklist.exe в текущей папке подменил бы системный.
 */
function systemTool(name: string): string {
  const root = process.env['SystemRoot'] ?? 'C:\\Windows'
  return path.join(root, 'System32', name)
}

interface ProcessScan {
  names: Set<string>
  /** Список процессов удалось получить. false — проверка не состоялась */
  checked: boolean
}

async function runningProcessNames(): Promise<ProcessScan> {
  const names = new Set<string>()
  try {
    const { stdout } = await execFileAsync(systemTool('tasklist.exe'), ['/FO', 'CSV', '/NH'], {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024
    })
    for (const line of stdout.split('\n')) {
      const match = line.match(/^"([^"]+)"/)
      if (match) names.add(match[1].toLowerCase())
    }
    // Пустой список означает, что утилита отработала, но ничего не вернула —
    // так не бывает, значит доверять результату нельзя
    return { names, checked: names.size > 0 }
  } catch {
    return { names, checked: false }
  }
}

/**
 * Проверяет, безопасно ли копировать файлы прямо сейчас.
 *
 * Это не формальность: запущенный Steam держит собственное представление о
 * содержимом облачных файлов и при выходе перезапишет наши изменения тем, что
 * помнит сам. Игра поверх этого перезаписывает конфиг при выходе из настроек.
 *
 * Если список процессов получить не удалось (политики, антивирус, не Windows),
 * возвращается checked: false. Отсутствие ответа трактуется как «неизвестно»,
 * а не как «всё закрыто» — иначе защита молча пропускала бы перенос.
 */
export async function preflight(gameProcessNames: string[]): Promise<PreflightResult> {
  const scan = await runningProcessNames()

  const foundSteam = STEAM_PROCESSES.filter((name) => scan.names.has(name))
  const foundGame = gameProcessNames
    .map((name) => name.toLowerCase())
    .filter((name) => scan.names.has(name))

  return {
    checked: scan.checked,
    // steamwebhelper без steam.exe — это остаточный процесс, сам по себе он
    // конфиги не трогает, поэтому смотрим именно на главный процесс
    steamRunning: scan.names.has('steam.exe'),
    gameRunning: foundGame.length > 0,
    processNames: [...foundSteam, ...foundGame]
  }
}
