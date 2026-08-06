import { COMMON_DENY_PATTERNS, type GameProfile } from './types'

/**
 * Dota 2, appid 570.
 * Все пути сверены с реальной установкой Steam, а не взяты из документации.
 */
export const dota2Profile: GameProfile = {
  appId: '570',
  name: 'Dota 2',
  processNames: ['dota2.exe'],
  groups: [
    {
      id: 'keys',
      labelKey: 'group.dota.keys',
      descriptionKey: 'group.dota.keys.desc',
      defaultEnabled: true,
      patterns: [
        // Основной файл раскладки: способности, предметы, камера, быстрое применение
        'remote/cfg/dotakeys_personal.lst',
        // Бинды уровня движка (консоль, скрытие интерфейса)
        'remote/user_keys.vcfg',
        'local/cfg/user_keys_0_slot*.vcfg'
      ]
    },
    {
      id: 'settings',
      labelKey: 'group.dota.settings',
      descriptionKey: 'group.dota.settings.desc',
      defaultEnabled: true,
      patterns: ['remote/user_convars.vcfg', 'local/cfg/user_convars_0_slot*.vcfg']
    },
    {
      id: 'controlgroups',
      labelKey: 'group.dota.controlgroups',
      descriptionKey: 'group.dota.controlgroups.desc',
      defaultEnabled: true,
      patterns: ['remote/scripts/control_groups.txt']
    },
    {
      id: 'chat',
      labelKey: 'group.dota.chat',
      descriptionKey: 'group.dota.chat.desc',
      defaultEnabled: true,
      patterns: ['remote/cfg/chat.cfg']
    },
    {
      id: 'herogrid',
      labelKey: 'group.dota.herogrid',
      descriptionKey: 'group.dota.herogrid.desc',
      defaultEnabled: false,
      patterns: ['remote/cfg/hero_grid_config.json']
    },
    {
      id: 'builds',
      labelKey: 'group.dota.builds',
      descriptionKey: 'group.dota.builds.desc',
      defaultEnabled: false,
      patterns: [
        'remote/cfg/herobuilds.cfg',
        'remote/cfg/hero_facet_config.cfg',
        'remote/scripts/item_suggest_preference.txt',
        'remote/guides/*.build'
      ]
    },
    {
      id: 'video',
      labelKey: 'group.dota.video',
      descriptionKey: 'group.dota.video.desc',
      defaultEnabled: false,
      advisoryKey: 'advisory.machineSpecific',
      patterns: ['local/cfg/video.txt', 'local/cfg/machine_convars.vcfg']
    }
  ],
  denyPatterns: [
    ...COMMON_DENY_PATTERNS,
    // Ниже — данные, привязанные к личности аккаунта. Их перенос не «копирует
    // настройки», а подменяет статистику и историю целевого аккаунта.
    'remote/cfg/stats.dat',
    'remote/cfg/last_match.dat',
    'remote/cfg/challenge_selections.cfg',
    'remote/cfg/fantasy_crafting.lst',
    'remote/cfg/viewedheropatches.cfg',
    'remote/cfg/pending_replay_requests.lst',
    'remote/cfg/dismissed_help_tips.txt',
    'remote/cfg/contextual_tips_history.json',
    'remote/voice_ban.dt',
    'remote/favorite_friends.json',
    'remote/item_clientacks.txt',
    'remote/comic_book_statistics.vdf',
    'remote/scripts/clientstorage.txt',
    'remote/scripts/dota_acknowledged_violators.txt',
    'remote/scripts/lobby_settings.txt',
    'remote/teams/*',
    'remote/guild/*',
    'local/cfg/trustedlaunch.cfg'
  ]
}
