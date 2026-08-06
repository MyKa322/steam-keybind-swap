import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { RendererApi } from '@shared/api'

/**
 * Мост между renderer и main.
 *
 * Renderer работает с изолированным контекстом и без доступа к Node — наружу
 * торчит только этот заранее описанный набор методов. Никаких «дай прочитать
 * произвольный путь»: любые операции с файлами идут через типизированные
 * команды, где main сам решает, что допустимо.
 */
const api: RendererApi = {
  steam: {
    detect: () => ipcRenderer.invoke(IPC.steamDetect),
    pickFolder: () => ipcRenderer.invoke(IPC.steamPickFolder)
  },
  games: {
    list: () => ipcRenderer.invoke(IPC.gamesList)
  },
  accounts: {
    list: () => ipcRenderer.invoke(IPC.accountsList),
    reveal: (accountId, appId) => ipcRenderer.invoke(IPC.accountReveal, accountId, appId)
  },
  transfer: {
    buildPlan: (request) => ipcRenderer.invoke(IPC.planBuild, request),
    diff: (request) => ipcRenderer.invoke(IPC.diffFile, request),
    preflight: (appId) => ipcRenderer.invoke(IPC.transferPreflight, appId),
    apply: (plan) => ipcRenderer.invoke(IPC.transferApply, plan)
  },
  backups: {
    list: () => ipcRenderer.invoke(IPC.backupsList),
    restore: (backupId) => ipcRenderer.invoke(IPC.backupsRestore, backupId),
    remove: (backupId) => ipcRenderer.invoke(IPC.backupsDelete, backupId),
    reveal: (backupId) => ipcRenderer.invoke(IPC.backupsReveal, backupId)
  },
  bundle: {
    export: (request) => ipcRenderer.invoke(IPC.bundleExport, request),
    pick: () => ipcRenderer.invoke(IPC.bundlePick)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch)
  },
  window: {
    minimize: () => ipcRenderer.send(IPC.windowMinimize),
    toggleMaximize: () => ipcRenderer.send(IPC.windowToggleMaximize),
    close: () => ipcRenderer.send(IPC.windowClose),
    onMaximizedChanged: (handler) => {
      const listener = (_event: unknown, maximized: boolean): void => handler(maximized)
      ipcRenderer.on(IPC.windowMaximizedChanged, listener)
      return () => ipcRenderer.removeListener(IPC.windowMaximizedChanged, listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
