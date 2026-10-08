import type { ButtonHTMLAttributes } from 'react'
import { cx } from '../lib/css'

// ============================================================================
// The one button in the app.
//
// `pending` is a first-class prop rather than something each screen wires up by
// hand: every submit here talks to the network, and a form that can be
// double-submitted (creating two accounts, or two reset consumptions) is a bug,
// so the disabled + aria-busy pairing lives in the component.
//
// `variant` is where the monochrome palette shows up: `solid` is a black bar, and
// with no accent hue left to spend on a hover state it inverts to white-on-black
// instead — a darker shade of black would be indistinguishable from the resting
// state.
// ============================================================================

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  pending?: boolean
  pendingLabel?: string
  variant?: 'solid' | 'outline' | 'danger' | 'ghost'
  size?: 'sm' | 'md'
}

export function Button({
  pending = false,
  pendingLabel = 'Working',
  variant = 'solid',
  size = 'md',
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled === true || pending}
      aria-busy={pending || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2.5',
        'font-mono uppercase tracking-[0.16em]',
        'border transition-[background-color,color,border-color,transform] duration-150',
        'active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55',
        size === 'md' && 'px-5 py-3 text-xs tracking-[0.18em]',
        size === 'sm' && 'px-3.5 py-2 text-[0.6875rem]',
        variant === 'solid' && 'border-ink bg-ink text-paper hover:bg-paper hover:text-ink',
        variant === 'outline' && 'border-rule bg-transparent text-ink hover:border-ink hover:bg-paper-deep',
        variant === 'ghost' && 'border-transparent bg-transparent text-ink-soft hover:border-rule hover:text-ink',
        // The one chromatic variant, reserved for an irreversible action
        // (UI-ROADMAP ground rule 3 / spec §4) — a filled black button and a
        // "Delete" label read as ordinary once they sit in a row of others.
        variant === 'danger' &&
          'border-danger bg-danger text-paper hover:bg-paper hover:text-danger',
        className,
      )}
    >
      {pending ? (
        <>
          <span
            aria-hidden="true"
            className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"
          />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  )
}
