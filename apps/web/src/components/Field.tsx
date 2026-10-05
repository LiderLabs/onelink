import { useId } from 'react'
import type { InputHTMLAttributes } from 'react'
import { cx, stagger } from '../lib/css'

// ============================================================================
// A labelled text input.
//
// The label is always a real <label>, the hint and the error are wired through
// `aria-describedby`, and `aria-invalid` is set only when there is an error —
// so a screen reader announces the problem with the field rather than leaving
// the user to hunt for it. Nothing here relies on placeholder text to carry
// meaning, because placeholders vanish the moment someone starts typing.
// ============================================================================

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string
  hint?: string
  error?: string | null
  /** Position in the entrance stagger. */
  delay?: number
  id?: string
}

export function Field({ label, hint, error, delay = 0, id, className, ...rest }: FieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined

  return (
    <div className="reveal" style={stagger(delay)}>
      <label htmlFor={inputId} className="eyebrow mb-2 block">
        {label}
      </label>
      <input
        {...rest}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(
          'w-full border-b bg-transparent pb-2 pt-1 text-lg text-ink',
          'placeholder:font-sans placeholder:text-ink-faint',
          'transition-colors duration-150 focus:border-ink focus:outline-none',
          error ? 'border-vermilion' : 'border-rule',
          className,
        )}
      />
      {hint ? (
        <p id={hintId} className="mt-2 font-mono text-[0.6875rem] leading-relaxed text-ink-faint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-2 text-xs font-medium text-vermilion">
          {error}
        </p>
      ) : null}
    </div>
  )
}
