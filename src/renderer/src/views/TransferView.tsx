import { useMemo, useState, type JSX } from 'react'
import type { DiffRequest, PlannedFile, TransferSource } from '@shared/types'
import { useApp } from '../store/app'
import type { DictKey, Translate } from '../i18n'
import { AccountCard } from '../components/AccountCard'
import { DiffModal } from '../components/DiffModal'
import { Check, Empty, Notice, Section, Spinner, formatBytes } from '../components/ui'
import { IconCloud, IconWarning } from '../components/Icons'

export function TransferView({ t, locale }: { t: Translate; locale: string }): JSX.Element {
  const store = useApp()
  const [diffRequest, setDiffRequest] = useState<DiffRequest | null>(null)

  const game = store.games.find((g) => g.appId === store.appId)
  const accounts = useMemo(
    () => store.accounts.filter((a) => a.games.some((g) => g.appId === store.appId)),
    [store.accounts, store.appId]
  )

  const source: TransferSource | null = store.bundle
    ? { kind: 'bundle', bundlePath: store.bundle.path, label: store.bundle.sourceLabel ?? '' }
    : store.sourceAccountId
      ? { kind: 'account', accountId: store.sourceAccountId }
      : null

  const canBuild = source !== null && store.targetIds.length > 0 && store.groupIds.length > 0
  const writeCount =
    store.plan?.targets.reduce(
      (sum, target) =>
        sum + target.files.filter((f) => f.action === 'add' || f.action === 'overwrite').length,
      0
    ) ?? 0

  if (!store.detection?.location) {
    return (
      <Notice kind="danger" icon={<IconWarning />} title={t('error.noSteam')}>
        {store.detection?.error ?? t('error.noSteamBody')}
      </Notice>
    )
  }

  return (
    <>
      <h1 className="page-title">{t('transfer.title')}</h1>
      <p className="page-subtitle">{t('transfer.subtitle')}</p>

      <div className="gametabs">
        {store.games.map((profile) => {
          const count = store.accounts.filter((a) =>
            a.games.some((g) => g.appId === profile.appId)
          ).length
          return (
            <button
              key={profile.appId}
              className={`gametab${profile.appId === store.appId ? ' gametab--active' : ''}`}
              onClick={() => store.setAppId(profile.appId)}
            >
              {profile.name}
              {/* Скобки обязательны: название игры само кончается цифрой,
                  и «Dota 2 3» читалось бы как часть названия */}
              <span className="gametab__count">({count})</span>
            </button>
          )
        })}
      </div>

      <PreflightBanner t={t} />

      {accounts.length === 0 ? (
        <Notice kind="warn" icon={<IconWarning />} title={t('error.noAccounts')}>
          {t('error.noAccountsBody')}
        </Notice>
      ) : null}

      <Section
        title={t('section.source')}
        hint={t('source.hint')}
        action={
          store.sourceAccountId ? (
            <button className="btn btn--link" onClick={() => void store.exportBundle(true)}>
              {t('source.export')}
            </button>
          ) : null
        }
      >
        {store.bundle ? (
          <div className="preview">
            <div className="preview__head">
              <span className="preview__target">
                {store.bundle.sourceLabel ?? t('source.bundle')}
              </span>
              <span className="dim">
                {store.bundle.fileCount} {t('source.bundleFiles')} ·{' '}
                {formatBytes(store.bundle.totalSize)}
              </span>
              <span className="filerow__spacer" />
              <button className="btn btn--ghost btn--small" onClick={() => store.clearBundle()}>
                {t('common.cancel')}
              </button>
            </div>
            <div className="filerow">
              <span className="filerow__path dim">{store.bundle.path}</span>
            </div>
          </div>
        ) : (
          <div className="accounts">
            {accounts.map((account) => (
              <AccountCard
                key={account.accountId}
                account={account}
                appId={store.appId}
                selected={store.sourceAccountId === account.accountId}
                round
                locale={locale}
                t={t}
                onClick={() => store.setSourceAccount(account.accountId)}
              />
            ))}
            <button className="account" onClick={() => void store.pickBundle()}>
              <span className="account__avatar">＋</span>
              <span className="account__body">
                <span className="account__name">{t('source.fromFile')}</span>
                <span className="account__meta">{t('source.fromFileDesc')}</span>
              </span>
            </button>
          </div>
        )}
      </Section>

      <Section
        title={t('section.targets')}
        hint={t('targets.hint')}
        action={
          <span className="row">
            <button className="btn btn--link" onClick={() => store.setAllTargets(true)}>
              {t('targets.selectAll')}
            </button>
            <button className="btn btn--link" onClick={() => store.setAllTargets(false)}>
              {t('targets.clear')}
            </button>
          </span>
        }
      >
        <div className="accounts">
          {accounts.map((account) => {
            const isSource = account.accountId === store.sourceAccountId
            return (
              <AccountCard
                key={account.accountId}
                account={account}
                appId={store.appId}
                selected={store.targetIds.includes(account.accountId)}
                disabled={isSource}
                locale={locale}
                t={t}
                onClick={() => store.toggleTarget(account.accountId)}
              />
            )
          })}
        </div>
      </Section>

      <Section title={t('section.groups')} hint={t('groups.hint')}>
        <div className="groups">
          {game?.groups.map((group) => (
            <label key={group.id} className="group">
              <input
                className="check-input"
                type="checkbox"
                checked={store.groupIds.includes(group.id)}
                onChange={() => store.toggleGroup(group.id)}
              />
              <Check on={store.groupIds.includes(group.id)} />
              <span>
                <span className="group__title">{t(group.labelKey as DictKey)}</span>
                <span className="group__desc">{t(group.descriptionKey as DictKey)}</span>
                {group.advisoryKey ? (
                  <span className="group__advisory">⚠ {t(group.advisoryKey as DictKey)}</span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      </Section>

      {store.plan ? (
        <Section title={t('section.preview')}>
          {store.planStale ? (
            <Notice
              kind="warn"
              icon={<IconWarning />}
              title={t('preview.stale')}
              actions={
                <button
                  className="btn btn--primary btn--small"
                  disabled={!canBuild || store.planLoading}
                  onClick={() => void store.buildPlan()}
                >
                  {t('action.buildPlan')}
                </button>
              }
            >
              {t('preview.staleBody')}
            </Notice>
          ) : null}

          {writeCount === 0 ? (
            <Empty>{t('preview.nothingToDo')}</Empty>
          ) : (
            store.plan.targets.map((target) => (
              <div
                className={`preview${store.planStale ? ' preview--stale' : ''}`}
                key={target.accountId}
              >
                <div className="preview__head">
                  <span className="dim">{t('preview.target')}</span>
                  <span className="preview__target">{target.label}</span>
                  <span className="filerow__spacer" />
                  <span className="dim">
                    {t('preview.willWrite')} {target.counts.add + target.counts.overwrite}
                  </span>
                </div>
                {target.files.map((file) => (
                  <FileRow
                    key={file.relPath}
                    file={file}
                    t={t}
                    onCompare={
                      file.action === 'overwrite' && source
                        ? () =>
                            setDiffRequest({
                              appId: store.appId,
                              source,
                              targetAccountId: target.accountId,
                              relPath: file.relPath
                            })
                        : undefined
                    }
                  />
                ))}
              </div>
            ))
          )}
        </Section>
      ) : null}

      <div className="actionbar">
        <button
          className="btn btn--primary"
          disabled={!canBuild || store.planLoading}
          onClick={() => void store.buildPlan()}
        >
          {store.planLoading ? <Spinner /> : null}
          {t('action.buildPlan')}
        </button>

        <button
          className="btn btn--green"
          disabled={!store.plan || store.planStale || writeCount === 0 || store.applying}
          onClick={() => void store.apply()}
        >
          {store.applying ? <Spinner /> : null}
          {t('action.apply')}
        </button>

        <span className="actionbar__summary">
          {store.planStale
            ? t('preview.stale')
            : store.plan
              ? `${t('preview.willWrite')} ${writeCount} · ${store.plan.targets.length} × ${t('preview.target').toLowerCase()}`
              : store.targetIds.length === 0
                ? t('targets.none')
                : t('preview.empty')}
        </span>
        <span className="actionbar__spacer" />
      </div>

      {diffRequest ? (
        <DiffModal request={diffRequest} t={t} onClose={() => setDiffRequest(null)} />
      ) : null}
    </>
  )
}

function FileRow({
  file,
  t,
  onCompare
}: {
  file: PlannedFile
  t: Translate
  onCompare?: () => void
}): JSX.Element {
  return (
    <div className="filerow">
      <span className={`badge badge--${file.action}`}>{t(`badge.${file.action}` as DictKey)}</span>
      <span className="filerow__path">{file.relPath}</span>
      {file.cloudSynced ? (
        <span className="badge badge--cloud" title={t('badge.cloud')}>
          <IconCloud />
        </span>
      ) : null}
      <span className="filerow__spacer" />
      <span className="filerow__size">
        {formatBytes(file.targetSize)} → {formatBytes(file.sourceSize)}
      </span>
      {onCompare ? (
        <button className="btn btn--link" onClick={onCompare}>
          {t('action.showDiff')}
        </button>
      ) : null}
    </div>
  )
}

function PreflightBanner({ t }: { t: Translate }): JSX.Element | null {
  const { preflight, refreshPreflight, settings } = useApp()
  if (!preflight) return null

  if (preflight.gameRunning) {
    return (
      <Notice
        kind="danger"
        icon={<IconWarning />}
        title={t('preflight.gameRunning')}
        actions={
          <button className="btn btn--ghost btn--small" onClick={() => void refreshPreflight()}>
            {t('action.recheck')}
          </button>
        }
      >
        {t('preflight.gameRunningBody')}
        <div className="mono dim" style={{ marginTop: 4 }}>
          {t('preflight.processes')} {preflight.processNames.join(', ')}
        </div>
      </Notice>
    )
  }

  if (!preflight.checked && !settings?.allowWhenSteamRunning) {
    return (
      <Notice
        kind="warn"
        icon={<IconWarning />}
        title={t('preflight.unknown')}
        actions={
          <button className="btn btn--ghost btn--small" onClick={() => void refreshPreflight()}>
            {t('action.recheck')}
          </button>
        }
      >
        {t('preflight.unknownBody')}
      </Notice>
    )
  }

  if (preflight.steamRunning && !settings?.allowWhenSteamRunning) {
    return (
      <Notice
        kind="warn"
        icon={<IconWarning />}
        title={t('preflight.steamRunning')}
        actions={
          <button className="btn btn--ghost btn--small" onClick={() => void refreshPreflight()}>
            {t('action.recheck')}
          </button>
        }
      >
        {t('preflight.steamRunningBody')}
      </Notice>
    )
  }

  return null
}
