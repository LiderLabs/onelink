import type { ReactNode } from 'react'
import { cx, stagger } from '../lib/css'

// ============================================================================
// "There is nothing here yet" — which is a different screen from "there is
// something here and it failed" (ErrorNotice) and from "you are not allowed to
// ask" (a sentence in place of the section).
//
// It always offers a way forward, because an empty state with no action is a
// dead end: either the action that creates the first item, or a sentence
// explaining why there is nothing.
// ============================================================================

export interface EmptyStateProps {
  title: string
  children: ReactNode
  action?: ReactNode
  delay?: number
}

export function EmptyState({ title, children, action, delay = 0 }: EmptyStateProps) {
  return (
    <div
      className="reveal border border-dashed border-rule px-5 py-7 text-center"
      style={stagger(delay)}
    >
      <p className="font-display text-xl font-medium text-ink">{title}</p>
      <p className={cx('mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-soft')}>
        {children}
      </p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  )
}