import { useEffect, useMemo, type JSX } from 'react'
import { useApp, type View } from './store/app'
import { createTranslate, type DictKey } from './i18n'
import { TitleBar } from './components/TitleBar'
import { IconBackup, IconSettings, IconTransfer } from './components/Icons'
import { Modal, Notice, Spinner } from './components/ui'
import { TransferView } from './views/TransferView'
import { BackupsView } from './views/BackupsView'
import { SettingsView } from './views/SettingsView'

const LOCALES: Record<string, string> = { ru: 'ru-RU', en: 'en-GB', uk: 'uk-UA' }

export function App(): JSX.Element {
  const store = useApp()
  const language = store.settings?.language ?? 'ru'
  const t = useMemo(() => createTranslate(language), [language])
  const locale = LOCALES[language] ?? 'ru-RU'

  useEffect(() => {
    void store.init()
    // init выполняется один раз за жизнь окна
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    document.documentElement.lang = language
    document.title = t('app.title')
  }, [language, t])

  const nav: { view: View; icon: JSX.Element; label: DictKey; badge?: number }[] = [
    { view: 'transfer', icon: <IconTransfer />, label: 'nav.transfer' },
    { view: 'backups', icon: <IconBackup />, label: 'nav.backups', badge: store.backups.length },
    { view: 'settings', icon: <IconSettings />, label: 'nav.settings' }
  ]

  return (
    <div className="app">
      <TitleBar title={t('app.title')} />

      <div className="body">
        <nav className="sidebar">
          <div className="sidebar__nav">
            {nav.map((item) => (
              <button
                key={item.view}
                className={`navitem${store.view === item.view ? ' navitem--active' : ''}`}
                onClick={() => store.setView(item.view)}
              >
                {item.icon}
                {t(item.label)}
                {item.badge ? <span className="navitem__badge">{item.badge}</span> : null}
              </button>
            ))}
          </div>

          <div className="sidebar__footer">
            {store.detection?.location ? (
              <span className="mono">{store.detection.location.path}</span>
            ) : (
              t('error.noSteam')
            )}
          </div>
        </nav>

        <main className="content">
          <div className="content__inner">
            {!store.ready ? (
              <div className="row">
                <Spinner /> {t('common.loading')}
              </div>
            ) : store.view === 'transfer' ? (
              <TransferView t={t} locale={locale} />
            ) : store.view === 'backups' ? (
              <BackupsView t={t} locale={locale} />
            ) : (
              <SettingsView t={t} />
            )}
          </div>
        </main>
      </div>

      {store.applyResult ? <ApplyResultModal /> : null}

      <div className="toasts">
        {store.toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast${toast.kind === 'info' ? '' : ` toast--${toast.kind}`}`}
            onClick={() => store.dismissToast(toast.id)}
          >
            {toast.text}
          </div>
        ))}
      </div>
    </div>
  )
}

function ApplyResultModal(): JSX.Element {
  const { applyResult, dismissApplyResult, restoreBackup, settings, revealBackup } = useApp()
  const t = createTranslate(settings?.language ?? 'ru')
  if (!applyResult) return <></>

  const copied = applyResult.targets.reduce((sum, target) => sum + target.copiedCount, 0)
  const failed = applyResult.targets.reduce((sum, target) => sum + target.failedCount, 0)
  const patched = applyResult.targets.reduce((sum, target) => sum + target.remoteCachePatched, 0)

  return (
    <Modal
      title={t('apply.title')}
      onClose={dismissApplyResult}
      footer={
        <button className="btn btn--primary" onClick={dismissApplyResult}>
          {t('common.close')}
        </button>
      }
    >
      <div className="diff__stats">
        <span>
          {t('apply.copied')} <b>{copied}</b>
        </span>
        {failed > 0 ? (
          <span style={{ color: 'var(--danger)' }}>
            {t('apply.failed')} <b>{failed}</b>
          </span>
        ) : null}
        <span className="dim">
          {t('apply.cachePatched')} {patched}
        </span>
      </div>

      {applyResult.ranWithSteamOpen ? (
        <Notice kind="warn" title={t('preflight.steamRunning')}>
          {t('apply.ranWithSteamOpen')}
        </Notice>
      ) : null}

      <Notice title={t('apply.nextSteps')}>{t('apply.nextStepsBody')}</Notice>

      {applyResult.targets.map((target) => (
        <div className="preview" key={target.accountId}>
          <div className="preview__head">
            <span className="preview__target">{target.label}</span>
            <span className="dim">
              {t('apply.copied')} {target.copiedCount}
            </span>
            <span className="filerow__spacer" />
            {target.backupId ? (
              <>
                <button
                  className="btn btn--ghost btn--small"
                  onClick={() => void revealBackup(target.backupId as string)}
                >
                  {t('action.openFolder')}
                </button>
                <button
                  className="btn btn--primary btn--small"
                  onClick={() => void restoreBackup(target.backupId as string)}
                >
                  {t('action.rollback')}
                </button>
              </>
            ) : null}
          </div>

          {target.remoteCacheError ? (
            <div className="filerow">
              <span className="badge badge--missing-source">{t('badge.cloud')}</span>
              <span className="filerow__path">{target.remoteCacheError}</span>
            </div>
          ) : null}

          {target.files
            .filter((file) => file.status !== 'copied')
            .map((file) => (
              <div className="filerow" key={file.relPath}>
                <span className="badge badge--failed">{t('badge.failed')}</span>
                <span className="filerow__path">{file.relPath}</span>
                <span className="filerow__spacer" />
                <span className="filerow__size">{file.error}</span>
              </div>
            ))}
        </div>
      ))}
    </Modal>
  )
}
