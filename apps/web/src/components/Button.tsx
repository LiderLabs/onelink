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
  variant?: 'solid' | 'outline'
}

export function Button({
  pending = false,
  pendingLabel = 'Working',
  variant = 'solid',
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
        'inline-flex items-center justify-center gap-2.5 px-5 py-3',
        'font-mono text-xs uppercase tracking-[0.18em]',
        'border transition-[background-color,color,border-color,transform] duration-150',
        'active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55',
        variant === 'solid'
          ? 'border-ink bg-ink text-paper hover:bg-paper hover:text-ink'
          : 'border-rule bg-transparent text-ink hover:border-ink hover:bg-paper-deep',
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
