import { useEffect, useState, type JSX } from 'react'
import { IconClose, IconLogo, IconMaximize, IconMinimize } from './Icons'

/**
 * Своя рамка окна. В Steam заголовок — часть интерфейса, а не системная полоса,
 * поэтому окно создаётся без рамки, а кнопки управления рисуем сами.
 */
export function TitleBar({ title }: { title: string }): JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => window.api.window.onMaximizedChanged(setMaximized), [])

  return (
    <div className="titlebar">
      <span className="titlebar__mark">
        <IconLogo />
      </span>
      <span className="titlebar__title">{title}</span>
      <span className="titlebar__spacer" />
      <div className="titlebar__buttons">
        <button
          className="titlebar__button"
          onClick={() => window.api.window.minimize()}
          aria-label="Свернуть"
        >
          <IconMinimize />
        </button>
        <button
          className="titlebar__button"
          onClick={() => window.api.window.toggleMaximize()}
          aria-label="Развернуть"
        >
          <IconMaximize maximized={maximized} />
        </button>
        <button
          className="titlebar__button titlebar__button--close"
          onClick={() => window.api.window.close()}
          aria-label="Закрыть"
        >
          <IconClose />
        </button>
      </div>
    </div>
  )
}
