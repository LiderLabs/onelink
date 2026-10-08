import type { ButtonHTMLAttributes } from 'react'
import { cx } from '../lib/css'
import { Icon } from './Icon'
import type { IconName } from './Icon'

// ============================================================================
// An icon-only button.
//
// The row actions in the links and socials lists are icons (show/hide, edit,
// delete, drag) and nothing else — a wall of repeated words would bury the one
// thing the row is about. Because the visible content is an icon, the accessible
// name is mandatory: `label` is a required prop, not an optional one, so an
// unlabelled icon button cannot be built by accident.
// ============================================================================

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  icon: IconName
  /** The button's accessible name — required, because the icon is the only label. */
  label: string
  size?: number
  tone?: 'default' | 'danger'
}

export function IconButton({ icon, label, size = 18, tone = 'default', className, disabled, ...rest }: IconButtonProps) {
  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cx(
        'grid h-9 w-9 shrink-0 place-items-center rounded-md border border-transparent text-ink-soft',
        'transition-colors duration-150 hover:border-rule hover:bg-paper-deep',
        tone === 'danger' && 'hover:text-danger',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-transparent disabled:hover:bg-transparent',
        className,
      )}
    >
      <Icon name={icon} size={size} />
    </button>
  )
}
