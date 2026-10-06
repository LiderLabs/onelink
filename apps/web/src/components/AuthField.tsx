import { useId, useState } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'

interface AuthFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
  error?: string
  optional?: boolean
  labelAction?: ReactNode
}

export function AuthField({ label, hint, error, optional, labelAction, type, id, ...input }: AuthFieldProps) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const [visible, setVisible] = useState(false)
  const password = type === 'password'
  const description = error ?? hint

  return (
    <div className="auth-field">
      <div className="auth-field-label">
        <label htmlFor={fieldId}>{label}{optional ? <span>Optional</span> : null}</label>
        {labelAction}
      </div>
      <div className="auth-input-wrap">
        <input {...input} id={fieldId} type={password && visible ? 'text' : type}
          className={`auth-input${password ? ' auth-input-password' : ''}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={description ? `${fieldId}-description` : undefined} />
        {password ? <button type="button" className="auth-password-toggle" aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} aria-pressed={visible} aria-controls={fieldId} disabled={input.disabled} onClick={() => setVisible(!visible)}>{visible ? 'Hide' : 'Show'}</button> : null}
      </div>
      {description ? <p id={`${fieldId}-description`} className={error ? 'auth-field-error' : 'auth-field-hint'}>{description}</p> : null}
    </div>
  )
}
