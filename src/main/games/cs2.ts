import { COMMON_DENY_PATTERNS, type GameProfile } from './types'

/**
 * Counter-Strike 2, appid 730.
 * Второй профиль существует не «для галочки»: он доказывает, что движок
 * профилей работает, и пути тут тоже сверены с реальной установкой.
 */
export const cs2Profile: GameProfile = {
  appId: '730',
  name: 'Counter-Strike 2',
  processNames: ['cs2.exe'],
  groups: [
    {
      id: 'keys',
      labelKey: 'group.cs2.keys',
      descriptionKey: 'group.cs2.keys.desc',
      defaultEnabled: true,
      patterns: ['remote/cs2_user_keys.vcfg', 'local/cfg/cs2_user_keys_0_slot*.vcfg']
    },
    {
      id: 'settings',
      labelKey: 'group.cs2.settings',
      descriptionKey: 'group.cs2.settings.desc',
      defaultEnabled: true,
      patterns: ['remote/cs2_user_convars.vcfg', 'local/cfg/cs2_user_convars_0_slot*.vcfg']
    },
    {
      id: 'loadout',
      labelKey: 'group.cs2.loadout',
      descriptionKey: 'group.cs2.loadout.desc',
      defaultEnabled: false,
      patterns: [
        'remote/cfg/cs2_preferred_items.txt',
        'remote/cfg/cs2_loadout_favorites.txt',
        'remote/cfg/cs2_shuffle_slots.txt',
        'remote/cfg/csgo_saved_item_shuffles.txt'
      ]
    },
    {
      id: 'video',
      labelKey: 'group.cs2.video',
      descriptionKey: 'group.cs2.video.desc',
      defaultEnabled: false,
      advisoryKey: 'advisory.machineSpecific',
      patterns: ['local/cfg/cs2_video.txt', 'local/cfg/cs2_machine_convars.vcfg']
    }
  ],
  denyPatterns: [
    ...COMMON_DENY_PATTERNS,
    'remote/socache.dt',
    'local/socache.dt',
    'remote/voice_ban.dt',
    'local/cfg/trustedlaunch.cfg'
  ]
}
