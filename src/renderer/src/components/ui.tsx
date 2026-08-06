import type { JSX, ReactNode } from 'react'
import { IconCheck } from './Icons'

export function Check({ on, round }: { on: boolean; round?: boolean }): JSX.Element {
  return (
    <span className={`check${on ? ' check--on' : ''}${round ? ' check--round' : ''}`}>
      {on ? <IconCheck /> : null}
    </span>
  )
}

export function Section({
  title,
  hint,
  action,
  children
}: {
  title: string
  hint?: string
  action?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <section className="section">
      <div className="section__head">
        <h2 className="section__title">{title}</h2>
        {hint ? <span className="section__hint">{hint}</span> : null}
        {action ? <span className="section__action">{action}</span> : null}
      </div>
      {children}
    </section>
  )
}

export function Notice({
  kind = 'info',
  icon,
  title,
  children,
  actions
}: {
  kind?: 'info' | 'warn' | 'danger'
  icon?: ReactNode
  title: string
  children?: ReactNode
  actions?: ReactNode
}): JSX.Element {
  return (
    <div className={`notice${kind === 'info' ? '' : ` notice--${kind}`}`}>
      {icon ? <span style={{ flex: 'none', marginTop: 1 }}>{icon}</span> : null}
      <div>
        <div className="notice__title">{title}</div>
        {children ? <div className="notice__body">{children}</div> : null}
        {actions ? <div className="notice__actions">{actions}</div> : null}
      </div>
    </div>
  )
}

export function Modal({
  title,
  onClose,
  narrow,
  footer,
  children
}: {
  title: string
  onClose: () => void
  narrow?: boolean
  footer?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={`modal${narrow ? ' modal--narrow' : ''}`}>
        <div className="modal__head">
          <h3 className="modal__title">{title}</h3>
          <button className="modal__close" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__foot">{footer}</div> : null}
      </div>
    </div>
  )
}

export function Spinner(): JSX.Element {
  return <span className="spinner" />
}

export function Empty({ children }: { children: ReactNode }): JSX.Element {
  return <div className="empty">{children}</div>
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

export function formatDate(ms: number | null, locale: string): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
