import { useId, useState } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { AuthIcon } from './AuthPage'

interface AuthFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
  error?: string
  optional?: boolean
  labelAction?: ReactNode
  icon?: 'user' | 'email' | 'key' | 'shield'
  prefix?: string
}

export function AuthField({ label, hint, error, optional, labelAction, icon, prefix, type, id, ...input }: AuthFieldProps) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const [visible, setVisible] = useState(false)
  const password = type === 'password'
  const description = error ?? hint

  return (
    <div className="auth-field">
      <div className="auth-field-label">
        <label htmlFor={fieldId}>{label}{input.required ? <span className="auth-required">*</span> : null}{optional ? <span>Optional</span> : null}</label>
        {labelAction}
      </div>
      <div className={`auth-input-wrap${icon ? ' auth-input-with-icon' : ''}${prefix ? ' auth-input-with-prefix' : ''}`}>
        {icon ? <span className="auth-input-icon"><AuthIcon name={icon} /></span> : null}
        {prefix ? <span className="auth-input-prefix" aria-hidden="true">{prefix}</span> : null}
        <input {...input} id={fieldId} type={password && visible ? 'text' : type}
          className={`auth-input${password ? ' auth-input-password' : ''}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={description ? `${fieldId}-description` : undefined} />
        {password ? <button type="button" className="auth-password-toggle" aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} aria-pressed={visible} aria-controls={fieldId} disabled={input.disabled} onClick={() => setVisible(!visible)}><AuthIcon name={visible ? 'eye-off' : 'eye'} /></button> : null}
      </div>
      {description ? <p id={`${fieldId}-description`} className={error ? 'auth-field-error' : 'auth-field-hint'}>{description}</p> : null}
    </div>
  )
}
