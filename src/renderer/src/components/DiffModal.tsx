import { useEffect, useState, type JSX } from 'react'
import type { DiffRequest, FileDiff } from '@shared/types'
import { bindLabel, type DictKey, type Translate } from '../i18n'
import { Empty, Modal, Spinner, formatBytes } from './ui'

/**
 * Показывает не построчный diff файла, а изменения по смыслу: какое действие
 * было на какой клавише и станет на какой. Именно этот вопрос у пользователя
 * и возникает перед переносом.
 */
export function DiffModal({
  request,
  t,
  onClose
}: {
  request: DiffRequest
  t: Translate
  onClose: () => void
}): JSX.Element {
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.transfer.diff(request).then((result) => {
      if (cancelled) return
      if (result.ok) setDiff(result.value)
      else setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [request])

  return (
    <Modal title={`${t('diff.title')} — ${request.relPath.split('/').pop()}`} onClose={onClose}>
      {error ? <Empty>{error}</Empty> : null}
      {!diff && !error ? (
        <div className="row">
          <Spinner /> {t('common.loading')}
        </div>
      ) : null}

      {diff ? <DiffBody diff={diff} t={t} /> : null}
    </Modal>
  )
}

function DiffBody({ diff, t }: { diff: FileDiff; t: Translate }): JSX.Element {
  return (
    <>
      <div className="diff__stats">
        <span className="mono dim">{diff.relPath}</span>
        <span>
          {formatBytes(diff.targetSize)} <span className="diff__arrow">→</span>{' '}
          {formatBytes(diff.sourceSize)}
        </span>
      </div>

      {diff.noteKey ? (
        <div className="notice notice--warn">
          <div className="notice__body">{t(diff.noteKey as DictKey)}</div>
        </div>
      ) : null}

      {diff.rows.length === 0 ? (
        <Empty>{t('diff.empty')}</Empty>
      ) : (
        <>
          <div className="diff__stats">
            <span>
              {t('diff.stats.changed')}: <b>{diff.counts.changed}</b>
            </span>
            <span>
              {t('diff.stats.added')}: <b>{diff.counts.added}</b>
            </span>
            <span>
              {t('diff.stats.removed')}: <b>{diff.counts.removed}</b>
            </span>
            <span className="dim">
              {t('diff.stats.same')}: {diff.counts.same}
            </span>
          </div>

          <table className="difftable">
            <thead>
              <tr>
                <th style={{ width: '42%' }}>{t('diff.colAction')}</th>
                <th style={{ width: '29%' }}>{t('diff.colBefore')}</th>
                <th style={{ width: '29%' }}>{t('diff.colAfter')}</th>
              </tr>
            </thead>
            <tbody>
              {diff.rows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <span className="diff__action">{rowLabel(row.labelKey, row.key, t)}</span>
                    {row.fieldKey ? (
                      <span className="diff__field">{t(row.fieldKey as DictKey)}</span>
                    ) : null}
                  </td>
                  <td>
                    <Value text={row.before} t={t} />
                  </td>
                  <td>
                    <Value text={row.after} t={t} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  )
}

function rowLabel(labelKey: string | null, key: string, t: Translate): string {
  if (!labelKey) return key
  if (labelKey.startsWith('bind.')) return bindLabel(t, labelKey.slice('bind.'.length))
  const translated = t(labelKey as DictKey)
  return translated === labelKey ? key : translated
}

function Value({ text, t }: { text: string | null; t: Translate }): JSX.Element {
  if (text === null || text === '') {
    return <span className="diff__key diff__key--empty">{t('diff.unset')}</span>
  }
  return <span className="diff__key">{text}</span>
}
