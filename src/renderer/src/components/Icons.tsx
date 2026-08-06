import type { JSX } from 'react'

/** Иконки инлайном: одна лишняя зависимость ради десятка глифов не окупается. */

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

export function IconMinimize(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10">
      <path d="M0 5h10" {...stroke} />
    </svg>
  )
}

export function IconMaximize({ maximized }: { maximized: boolean }): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10">
      {maximized ? (
        <>
          <rect x="0.5" y="2.5" width="7" height="7" {...stroke} />
          <path d="M2.5 2.5V0.5h7v7h-2" {...stroke} />
        </>
      ) : (
        <rect x="0.5" y="0.5" width="9" height="9" {...stroke} />
      )}
    </svg>
  )
}

export function IconClose(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10">
      <path d="M0 0l10 10M10 0L0 10" {...stroke} />
    </svg>
  )
}

export function IconCheck(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M1.5 6.5l3 3 6-7" {...stroke} strokeWidth={2} />
    </svg>
  )
}

export function IconDot(): JSX.Element {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
      <circle cx="4" cy="4" r="4" fill="currentColor" />
    </svg>
  )
}

export function IconTransfer(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1 5h11M9 2l3 3-3 3M15 11H4M7 8l-3 3 3 3" {...stroke} />
    </svg>
  )
}

export function IconBackup(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2a6 6 0 106 6" {...stroke} />
      <path d="M8 4.5V8l2.5 1.5" {...stroke} />
      <path d="M14 2v3h-3" {...stroke} />
    </svg>
  )
}

export function IconSettings(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="2.4" {...stroke} />
      <path
        d="M8 1v2M8 13v2M1 8h2M13 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M12.9 3.1l-1.4 1.4M4.5 11.5l-1.4 1.4"
        {...stroke}
      />
    </svg>
  )
}

export function IconCloud(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 16 12" aria-hidden="true">
      <path d="M4 10.5a3 3 0 010-6 4 4 0 017.7 1A2.75 2.75 0 0111.5 10.5z" {...stroke} />
    </svg>
  )
}

export function IconWarning(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.5l6.5 12h-13z" {...stroke} />
      <path d="M8 6v3.5M8 11.4v.1" {...stroke} />
    </svg>
  )
}

export function IconLogo(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="0.75" y="2.75" width="14.5" height="10.5" rx="1.5" {...stroke} stroke="#67c1f5" />
      <path d="M4 6h1.5M7.2 6h1.6M10.5 6H12M4 9.5h8" {...stroke} stroke="#67c1f5" />
    </svg>
  )
}
