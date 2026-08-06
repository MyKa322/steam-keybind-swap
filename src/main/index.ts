import { app, BrowserWindow, session, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IPC } from '@shared/ipc'
import { AppState } from './state'
import { registerIpc } from './ipc'

const dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 620,
    show: false,
    // Своя рамка — в Steam титлбар часть интерфейса, а не системная полоса
    frame: false,
    backgroundColor: '#1b2838',
    webPreferences: {
      preload: path.join(dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.on('ready-to-show', () => window.show())

  const notifyMaximized = (): void => {
    window.webContents.send(IPC.windowMaximizedChanged, window.isMaximized())
  }
  window.on('maximize', notifyMaximized)
  window.on('unmaximize', notifyMaximized)

  // Внешние ссылки открываем в системном браузере, а не внутри приложения
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(path.join(dirname, '../renderer/index.html'))
  }

  return window
}

/**
 * Приложение работает полностью офлайн, поэтому политика запрещает всё внешнее.
 * data: разрешён только для картинок — так в интерфейс попадают аватарки из
 * локального кэша Steam.
 *
 * В режиме разработки политика не навешивается: Vite добавляет на страницу
 * инлайновый скрипт горячей перезагрузки, который она бы заблокировала.
 */
function applyContentSecurityPolicy(): void {
  if (process.env['ELECTRON_RENDERER_URL']) return

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'none'"
        ]
      }
    })
  })
}

// Второй экземпляр может начать копировать те же файлы параллельно — не даём
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(async () => {
    applyContentSecurityPolicy()

    const state = await AppState.create(app.getPath('userData'))
    registerIpc(state, () => mainWindow)

    mainWindow = createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
