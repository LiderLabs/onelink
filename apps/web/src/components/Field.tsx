import { useId } from 'react'
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { cx, stagger } from '../lib/css'

// ============================================================================
// Form controls — one shell, four controls.
//
// Accessibility is identical across all four, which is exactly why they share a
// shell instead of each repeating the wiring: the label is always a real
// <label>, the hint and the error are reachable through `aria-describedby`, and
// `aria-invalid` is set only when there IS an error, so a screen reader announces
// the problem with the field rather than leaving the user to hunt for it.
//
// Nothing here relies on placeholder text to carry meaning: placeholders vanish
// the moment someone starts typing, which is precisely when they are needed.
//
// Every control stays native (`<input>`, `<textarea>`, `<select>`, a real
// checkbox) rather than a rebuilt look-alike, so keyboard behaviour, autofill,
// screen-reader semantics and mobile pickers are the browser's, not ours
// (spec §4).
// ============================================================================

interface ControlIds {
  id: string
  describedBy: string | undefined
  invalid: boolean
}

interface FieldShellProps {
  label: string
  hint?: string | undefined
  error?: string | null | undefined
  /** Position in the entrance stagger. */
  delay?: number
  id?: string | undefined
  children: (ids: ControlIds) => ReactNode
}

/**
 * The label above, the hint and the error below, and the ids that tie them
 * together. A render prop because only the caller knows whether the control is an
 * input, a textarea or a select.
 */
function FieldShell({ label, hint, error, delay = 0, id, children }: FieldShellProps) {
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

      {children({ id: inputId, describedBy, invalid: Boolean(error) })}

      {hint ? (
        <p id={hintId} className="mt-2 font-mono text-[0.6875rem] leading-relaxed text-ink-faint">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} className="mt-2 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** The underline every control wears, so a form reads as one ruled sheet. */
function controlClass(options: { invalid: boolean; size: string; className?: string | undefined }) {
  return cx(
    'w-full border-b bg-transparent text-ink placeholder:text-ink-faint',
    options.size,
    'transition-colors duration-150 focus:border-ink focus:outline-none',
    options.invalid ? 'border-danger' : 'border-rule',
    options.className,
  )
}

// ------------------------------------------------------------------- input ---

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string
  hint?: string
  error?: string | null
  delay?: number
  id?: string
}

export function Field({ label, hint, error, delay = 0, id, className, ...rest }: FieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} delay={delay} id={id}>
      {({ id: inputId, describedBy, invalid }) => (
        <input
          {...rest}
          id={inputId}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={controlClass({ invalid, size: 'pb-2 pt-1 text-lg', className })}
        />
      )}
    </FieldShell>
  )
}

// ---------------------------------------------------------------- textarea ---

export interface TextareaFieldProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string
  hint?: string
  error?: string | null
  delay?: number
  id?: string
}

/**
 * Multi-line text. Resizable vertically only — a horizontally resizable textarea
 * is how a page ends up wider than the viewport it sits in.
 */
export function TextareaField({
  label,
  hint,
  error,
  delay = 0,
  id,
  className,
  ...rest
}: TextareaFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} delay={delay} id={id}>
      {({ id: inputId, describedBy, invalid }) => (
        <textarea
          {...rest}
          id={inputId}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cx(
            controlClass({ invalid, size: 'pb-2 pt-1 text-base leading-relaxed', className }),
            'min-h-[5.5rem] resize-y',
          )}
        />
      )}
    </FieldShell>
  )
}

// ------------------------------------------------------------------ select ---

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string
  hint?: string
  error?: string | null
  delay?: number
  id?: string
  options: Array<{ value: string; label: string }>
}

/**
 * A native select, deliberately: the OS picker is the right control on a phone
 * and the right control under a keyboard, and it needs no JavaScript of ours.
 */
export function SelectField({
  label,
  hint,
  error,
  delay = 0,
  id,
  options,
  className,
  ...rest
}: SelectFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} delay={delay} id={id}>
      {({ id: inputId, describedBy, invalid }) => (
        <select
          {...rest}
          id={inputId}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={controlClass({ invalid, size: 'pb-2 pt-1 text-lg', className })}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  )
}

// ---------------------------------------------------------------- checkbox ---

export interface CheckboxFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string
  hint?: string
  error?: string | null
  delay?: number
  id?: string
}

/**
 * A checkbox with its label beside it, not above it: that is where a checkbox's
 * label belongs, and the shell above is for controls that own a whole row.
 *
 * There is no `type` prop — it is always `checkbox`, so a caller cannot
 * accidentally render a text input with a checkbox's layout.
 */
export function CheckboxField({
  label,
  hint,
  error,
  delay = 0,
  id,
  className,
  ...rest
}: CheckboxFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined

  return (
    <div className="reveal" style={stagger(delay)}>
      <label htmlFor={inputId} className="flex cursor-pointer items-start gap-3">
        <input
          {...rest}
          id={inputId}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cx('mt-[0.2rem] h-4 w-4 shrink-0 accent-ink', className)}
        />
        <span className="text-sm leading-relaxed text-ink">
          {label}
          {error ? (
            <span id={errorId} className="mt-1 block text-xs font-medium text-danger">
              {error}
            </span>
          ) : null}
        </span>
      </label>

      {hint ? (
        <p
          id={hintId}
          className="ml-7 mt-1.5 font-mono text-[0.6875rem] leading-relaxed text-ink-faint"
        >
          {hint}
        </p>
      ) : null}
    </div>
  )
}
