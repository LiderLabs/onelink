import type { ReactNode } from 'react'
import { cx } from '../lib/css'

// ============================================================================
// A toolbar — the row of context actions that sits under a header.
//
// It is a labelled `role="group"` rather than a bare div so that a run of icon
// and text buttons is announced as one thing ("Filters", "Page actions") instead
// of as an unlabelled clutter of controls.
// ============================================================================

export interface ToolbarProps {
  /** The group's accessible name, e.g. "Filters". */
  label?: string
  children: ReactNode
  className?: string
}

export function Toolbar({ label, children, className }: ToolbarProps) {
  return (
    <div role="group" aria-label={label} className={cx('flex flex-wrap items-center gap-2.5', className)}>
      {children}
    </div>
  )
}
