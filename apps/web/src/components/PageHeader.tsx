import type { ReactNode } from 'react'
import { cx } from '../lib/css'

// ============================================================================
// The screen header.
//
// Every full screen opens the same way — a kicker, a title, one sentence of
// orientation, and the screen's primary actions on the right — so the header is
// declared once. It rules itself off with an ink border, which is the strongest
// line in the monochrome system and therefore the right weight for a page break.
// ============================================================================

export interface PageHeaderProps {
  eyebrow?: string
  title: string
  description?: ReactNode
  actions?: ReactNode
  className?: string
}

export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cx('flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-ink pb-6', className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight sm:text-4xl">{title}</h1>
        {description ? (
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-soft">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  )
}
