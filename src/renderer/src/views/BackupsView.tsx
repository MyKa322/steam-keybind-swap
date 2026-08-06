import type { JSX } from 'react'
import { useApp } from '../store/app'
import type { Translate } from '../i18n'
import { Empty, formatDate } from '../components/ui'

export function BackupsView({ t, locale }: { t: Translate; locale: string }): JSX.Element {
  const { backups, restoreBackup, deleteBackup, revealBackup } = useApp()

  return (
    <>
      <h1 className="page-title">{t('backups.title')}</h1>
      <p className="page-subtitle">{t('backups.subtitle')}</p>

      {backups.length === 0 ? <Empty>{t('backups.empty')}</Empty> : null}

      {backups.map((backup) => (
        <div className="backup" key={backup.id}>
          <div style={{ minWidth: 0 }}>
            <div className="backup__title">
              {backup.appName} → {backup.targetLabel}
            </div>
            <div className="backup__meta">
              {formatDate(backup.createdAt, locale)} · {t('backups.from')} {backup.sourceLabel} ·{' '}
              {backup.files.length} {t('preview.filesCount')}
              {backup.restoredAt
                ? ` · ${t('backups.restoredAt')} ${formatDate(backup.restoredAt, locale)}`
                : ''}
            </div>
          </div>

          <div className="backup__actions">
            <button
              className="btn btn--ghost btn--small"
              onClick={() => void revealBackup(backup.id)}
            >
              {t('action.openFolder')}
            </button>
            <button
              className="btn btn--primary btn--small"
              onClick={() => void restoreBackup(backup.id)}
            >
              {t('action.rollback')}
            </button>
            <button
              className="btn btn--danger btn--small"
              onClick={() => {
                if (confirm(t('backups.confirmDelete'))) void deleteBackup(backup.id)
              }}
            >
              {t('action.delete')}
            </button>
          </div>
        </div>
      ))}
    </>
  )
}
