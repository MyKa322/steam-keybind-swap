import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Поднимает только интерфейс, без Electron. Нужно для отладки вёрстки:
 * прокрутка, поведение элементов управления и раскладка воспроизводятся
 * один в один, но данные приходят из заглушки, а не из настоящего Steam.
 *
 * Заглушка window.api внедряется до загрузки приложения — иначе первый
 * рендер падает на обращении к мосту preload, которого в браузере нет.
 */
function stubPreloadBridge(): Plugin {
  return {
    name: 'stub-preload-bridge',
    transformIndexHtml: (html) =>
      html.replace('<body>', `<body><script>${STUB}</script>`)
  }
}

const STUB = /* js */ `
const ok = (v) => Promise.resolve({ ok: true, value: v });
const account = (id, name) => ({
  accountId: id, steamId64: '7656' + id, accountName: name, personaName: name,
  avatarDataUrl: null, lastLogin: 1786053445, isAutoLogin: id === '100000001',
  games: [{ appId: '570', name: 'Dota 2', known: true, fileCount: 18, lastModified: Date.now() }]
});
const groups = ['keys','settings','controlgroups','chat','herogrid','builds','video'].map((id, i) => ({
  id,
  labelKey: 'group.dota.' + id,
  descriptionKey: 'group.dota.' + id + '.desc',
  defaultEnabled: i < 4,
  advisoryKey: id === 'video' ? 'advisory.machineSpecific' : null
}));
const files = (n) => Array.from({ length: n }, (_, i) => ({
  relPath: 'remote/cfg/file_' + i + '.vcfg', groupId: 'keys',
  action: ['overwrite', 'add', 'identical'][i % 3],
  sourceSize: 1000 + i, sourceSha1: 'a', targetSize: 900 + i, targetSha1: 'b', cloudSynced: true
}));
window.api = {
  steam: {
    detect: () => ok({ location: { path: 'C:\\\\Steam', source: 'registry-hkcu', userdataPath: 'C:\\\\Steam\\\\userdata' }, error: null }),
    pickFolder: () => ok(null)
  },
  games: { list: () => ok([{ appId: '570', name: 'Dota 2', groups }, { appId: '730', name: 'Counter-Strike 2', groups }]) },
  accounts: {
    list: () => ok([account('100000001', 'Основной'), account('100000002', 'Смурф 1'), account('100000003', 'Смурф 2'), account('100000004', 'Смурф 3')]),
    reveal: () => ok(null)
  },
  transfer: {
    buildPlan: () => ok({
      appId: '570', appName: 'Dota 2', source: { kind: 'account', accountId: '100000001' },
      sourceLabel: 'Основной', groupIds: ['keys'], createdAt: Date.now(),
      targets: [
        { accountId: '100000002', label: 'Смурф 1', counts: { add: 8, overwrite: 8, identical: 8, 'missing-source': 0 }, files: files(24) },
        { accountId: '100000003', label: 'Смурф 2', counts: { add: 8, overwrite: 8, identical: 8, 'missing-source': 0 }, files: files(24) }
      ]
    }),
    diff: () => ok({ relPath: 'x', kind: 'keyvalues', rows: [], counts: { added: 0, changed: 0, removed: 0, same: 0 }, noteKey: null, sourceSize: 1, targetSize: 1, truncated: 0 }),
    preflight: () => ok({ checked: true, steamRunning: false, gameRunning: false, processNames: [] }),
    apply: () => ok({ targets: [], startedAt: 0, finishedAt: 0, ranWithSteamOpen: false })
  },
  backups: { list: () => ok([]), restore: () => ok(null), remove: () => ok(null), reveal: () => ok(null) },
  bundle: { export: () => ok(null), pick: () => ok(null) },
  settings: {
    get: () => ok({ language: 'ru', steamPathOverride: null, patchRemoteCache: true, allowWhenSteamRunning: false, includeAccountNameInExport: true, lastAppId: '570', lastSourceAccountId: null }),
    set: (patch) => ok({ language: 'ru', steamPathOverride: null, patchRemoteCache: true, allowWhenSteamRunning: false, includeAccountNameInExport: true, lastAppId: '570', lastSourceAccountId: null, ...patch })
  },
  window: { minimize() {}, toggleMaximize() {}, close() {}, onMaximizedChanged: () => () => {} }
};
`

export default defineConfig({
  root: resolve('src/renderer'),
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  plugins: [react(), stubPreloadBridge()],
  server: { port: 5199 }
})
