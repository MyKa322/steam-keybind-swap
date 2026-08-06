/** Имена IPC-каналов. Один источник правды для main и preload. */
export const IPC = {
  steamDetect: 'steam:detect',
  steamPickFolder: 'steam:pickFolder',

  gamesList: 'games:list',
  accountsList: 'accounts:list',
  accountReveal: 'accounts:reveal',

  planBuild: 'plan:build',
  diffFile: 'diff:file',

  transferPreflight: 'transfer:preflight',
  transferApply: 'transfer:apply',

  backupsList: 'backups:list',
  backupsRestore: 'backups:restore',
  backupsDelete: 'backups:delete',
  backupsReveal: 'backups:reveal',

  bundleExport: 'bundle:export',
  bundlePick: 'bundle:pick',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',

  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggleMaximize',
  windowClose: 'window:close',
  windowMaximizedChanged: 'window:maximizedChanged'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
