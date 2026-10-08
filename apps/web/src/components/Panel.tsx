import { useId } from 'react'
import type { ReactNode } from 'react'
import { cx, stagger } from '../lib/css'

// ============================================================================
// The panel.
//
// One ruled card, used everywhere a region of a screen needs to be bounded:
// dashboard tiles, editor forms, settings sections, analytics blocks. It exists
// so that "a titled region" is declared once instead of re-typed as a dozen
// near-identical class lists that drift apart.
//
// When it has a title it becomes a real `<section aria-labelledby>`, so a screen
// reader can jump between the regions of a long editor by their headings rather
// than by raw landmarks. Without a title it is a plain bordered box.
// ============================================================================

export interface PanelProps {
  /** Small mono kicker above the title, e.g. "Account". */
  eyebrow?: string
  /** The region's heading. Presence of a title makes this a landmark `<section>`. */
  title?: string
  /** A sentence under the heading explaining what the region holds. */
  description?: ReactNode
  /** Right-aligned controls in the header row. */
  action?: ReactNode
  id?: string
  /** Entrance-stagger index (kept in CSS via `--i`). */
  delay?: number
  className?: string
  bodyClassName?: string
  children: ReactNode
}

export function Panel({
  eyebrow,
  title,
  description,
  action,
  id,
  delay = 0,
  className,
  bodyClassName,
  children,
}: PanelProps) {
  const headingId = useId()
  const hasHeader = Boolean(eyebrow || title || description || action)

  return (
    <section
      id={id}
      aria-labelledby={title ? headingId : undefined}
      className={cx('reveal border border-rule bg-white/80', className)}
      style={stagger(delay)}
    >
      {hasHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3 border-b border-rule px-5 py-4 sm:px-6">
          <div className="min-w-0">
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            {title ? (
              <h2 id={headingId} className="mt-1 font-display text-xl font-medium leading-tight">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">{description}</p>
            ) : null}
          </div>
          {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
        </div>
      ) : null}

      <div className={cx('px-5 py-5 sm:px-6', bodyClassName)}>{children}</div>
    </section>
  )
}
