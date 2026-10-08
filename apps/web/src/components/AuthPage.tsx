import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../lib/session'

export function AuthIcon({ name }: { name: 'user' | 'email' | 'key' | 'shield' | 'eye' | 'eye-off' | 'arrow' | 'brand' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {name === 'user' ? <><circle cx="12" cy="8" r="3" /><path d="M5.5 20v-2a6.5 6.5 0 0 1 13 0v2z" /></> : null}
      {name === 'email' ? <><circle cx="12" cy="12" r="3.5" /><path d="M15.5 8.5v6a2 2 0 0 0 4 0V12a7.5 7.5 0 1 0-3.8 6.5" /></> : null}
      {name === 'key' ? <><circle cx="16" cy="8" r="4.5" /><path d="m12.5 11.5-8 8H2v-3l3-3h3l3-3M16.5 7.5h.01" /></> : null}
      {name === 'shield' ? <><path d="M12 3 4 6.5v5c0 4.5 8 9.5 8 9.5s8-5 8-9.5v-5z" /><path d="m8 12 2.5 2.5 5.5-5.5" /></> : null}
      {name === 'eye' || name === 'eye-off' ? <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{name === 'eye-off' ? <path d="m3 3 18 18" /> : null}</> : null}
      {name === 'arrow' ? <path d="M4 12h16m-6-6 6 6-6 6" /> : null}
      {name === 'brand' ? <><rect x="4" y="3" width="16" height="18" rx="5" /><circle cx="12" cy="12" r="2.5" /><path d="M12 9.5v2" /></> : null}
    </svg>
  )
}

/** Signup and sign-in share the reference's centered card; recovery keeps AuthFrame. */
export function AuthPage({ title, description, children, variant = 'login' }: {
  title: string
  description: string
  children: ReactNode
  variant?: 'login' | 'register'
}) {
  const { platformName } = useSession()
  useEffect(() => {
    const previous = document.title
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const previousTheme = theme?.content
    document.title = `${title} · ${platformName}`
    if (theme) theme.content = '#0c0e12'
    return () => {
      document.title = previous
      if (theme && previousTheme) theme.content = previousTheme
    }
  }, [title, platformName])
  return (
    <div className={`auth-layout auth-layout-${variant}`}>
      <section className="auth-form-panel" aria-labelledby="auth-title">
        <div className="auth-form-heading">
          <Link to="/" className="auth-brand" aria-label={`${platformName} home`}>
            <span className="auth-brand-mark"><AuthIcon name="brand" /></span>
            <span className="auth-wordmark">{platformName === 'OneLink' ? <>One<span>Link</span></> : platformName}</span>
          </Link>
          <h1 id="auth-title">{title}</h1>
          <p>{description}</p>
        </div>
        {children}
      </section>
    </div>
  )
}

export function AuthHeader() {
  return (
    <div className="auth-ambient" aria-hidden="true">
      <svg className="auth-ambient-grain" width="100%" height="100%">
        <filter id="auth-grain"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="3" stitchTiles="stitch" /></filter>
        <rect width="100%" height="100%" filter="url(#auth-grain)" />
      </svg>
    </div>
  )
}
