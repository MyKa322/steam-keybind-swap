import type { JSX } from 'react'
import type { SteamAccount } from '@shared/types'
import type { Translate } from '../i18n'
import { Check, formatDate } from './ui'

/**
 * Карточка аккаунта в духе списка друзей Steam: квадратная аватарка, ник белым,
 * служебная строка серым. Аватарка приходит из локального кэша Steam, поэтому
 * сеть не нужна.
 */
export function AccountCard({
  account,
  appId,
  selected,
  disabled,
  round,
  locale,
  t,
  onClick
}: {
  account: SteamAccount
  appId: string
  selected: boolean
  disabled?: boolean
  /** Круглая отметка — для выбора одного источника, квадратная — для нескольких целей */
  round?: boolean
  locale: string
  t: Translate
  onClick: () => void
}): JSX.Element {
  const game = account.games.find((g) => g.appId === appId)
  const name = account.personaName ?? account.accountName ?? t('account.noName')

  const meta = game?.lastModified
    ? `${t('account.modified')} ${formatDate(game.lastModified, locale)}`
    : t('account.noFiles')

  return (
    <button
      type="button"
      className={`account${selected ? ' account--selected' : ''}${disabled ? ' account--disabled' : ''}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      {account.avatarDataUrl ? (
        <img className="account__avatar" src={account.avatarDataUrl} alt="" />
      ) : (
        <span className="account__avatar">{name.slice(0, 1).toUpperCase()}</span>
      )}

      <span className="account__body">
        <span className="account__name">
          {name}
          {account.isAutoLogin ? (
            <span className="account__tag">{t('account.autoLogin')}</span>
          ) : null}
        </span>
        <span className="account__meta">{meta}</span>
        <span className="account__meta mono">{account.accountId}</span>
      </span>

      <Check on={selected} round={round} />
    </button>
  )
}
