import type { JSX } from 'react'
import type { Language } from '@shared/types'
import { useApp } from '../store/app'
import { LANGUAGE_NAMES, type DictKey, type Translate } from '../i18n'
import { Check, Section } from '../components/ui'

export function SettingsView({ t }: { t: Translate }): JSX.Element {
  const { settings, detection, updateSettings, pickSteamFolder } = useApp()
  if (!settings) return <></>

  return (
    <>
      <h1 className="page-title">{t('settings.title')}</h1>

      <Section title={t('settings.language')}>
        <select
          className="select"
          value={settings.language}
          onChange={(event) => void updateSettings({ language: event.target.value as Language })}
        >
          {(Object.keys(LANGUAGE_NAMES) as Language[]).map((code) => (
            <option key={code} value={code}>
              {LANGUAGE_NAMES[code]}
            </option>
          ))}
        </select>
      </Section>

      <Section title={t('settings.steamPath')}>
        <div className="field__row">
          <input className="input mono" readOnly value={detection?.location?.path ?? '—'} />
          <button className="btn btn--ghost" onClick={() => void pickSteamFolder()}>
            {t('action.browse')}
          </button>
          {settings.steamPathOverride ? (
            <button
              className="btn btn--ghost"
              onClick={() => void updateSettings({ steamPathOverride: null })}
            >
              {t('action.reset')}
            </button>
          ) : null}
        </div>
        <div className="section__hint" style={{ marginTop: 6 }}>
          {settings.steamPathOverride ? t('settings.steamPathManual') : t('settings.steamPathAuto')}
          {detection?.location
            ? ` · ${t(`settings.source.${detection.location.source}` as DictKey)}`
            : ''}
          {detection?.error ? ` · ${detection.error}` : ''}
        </div>
      </Section>

      <Section title={t('nav.transfer')}>
        <label className="toggle-row">
          <input
            className="check-input"
            type="checkbox"
            checked={settings.patchRemoteCache}
            onChange={() => void updateSettings({ patchRemoteCache: !settings.patchRemoteCache })}
          />
          <Check on={settings.patchRemoteCache} />
          <span>
            <span className="group__title">{t('settings.patchCache')}</span>
            <span className="group__desc">{t('settings.patchCacheDesc')}</span>
          </span>
        </label>

        <label className="toggle-row">
          <input
            className="check-input"
            type="checkbox"
            checked={settings.includeAccountNameInExport}
            onChange={() =>
              void updateSettings({
                includeAccountNameInExport: !settings.includeAccountNameInExport
              })
            }
          />
          <Check on={settings.includeAccountNameInExport} />
          <span>
            <span className="group__title">{t('source.includeLabel')}</span>
            <span className="group__desc">{t('settings.includeLabelDesc')}</span>
          </span>
        </label>

        <label className="toggle-row">
          <input
            className="check-input"
            type="checkbox"
            checked={settings.allowWhenSteamRunning}
            onChange={() =>
              void updateSettings({ allowWhenSteamRunning: !settings.allowWhenSteamRunning })
            }
          />
          <Check on={settings.allowWhenSteamRunning} />
          <span>
            <span className="group__title">
              {t('settings.allowSteamRunning')}
              <span className="account__tag" style={{ color: 'var(--warn)' }}>
                {t('settings.dangerous')}
              </span>
            </span>
            <span className="group__desc">{t('settings.allowSteamRunningDesc')}</span>
          </span>
        </label>
      </Section>
    </>
  )
}
