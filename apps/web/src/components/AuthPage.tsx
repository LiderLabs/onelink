import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation, useMatch } from 'react-router-dom'
import { useSession } from '../lib/session'
import { safeNext } from './Guards'

/** A shared composition for the two entry points; recovery keeps AuthFrame. */
export function AuthPage({ title, description, children }: {
  title: string
  description: string
  children: ReactNode
}) {
  const { platformName } = useSession()
  useEffect(() => {
    const previous = document.title
    document.title = `${title} · ${platformName}`
    return () => { document.title = previous }
  }, [title, platformName])
  return (
    <div className="auth-layout">
      <aside className="auth-story reveal" aria-label={`About ${platformName}`}>
        <p className="auth-kicker">A little space. All yours.</p>
        <h2>All your links.<br />A place of<br /><em>their own.</em></h2>
        <p className="auth-story-copy">Bring your work, your ideas, and your favorite corners of the internet together.</p>
        <div className="auth-preview" aria-hidden="true">
          <div className="auth-preview-top"><span className="auth-preview-dot" /><span>A page with personality</span><span>↗</span></div>
          <div className="auth-preview-profile">
            <span className="auth-avatar">ar<span>✳</span></span>
            <strong>Alex Rivera</strong>
            <p>Designer, maker, curious human.</p>
          </div>
          <div className="auth-preview-link"><span><small>01</small> Selected work</span><span>↗</span></div>
          <div className="auth-preview-link"><span><small>02</small> Studio notes</span><span>↗</span></div>
          <div className="auth-preview-link"><span><small>03</small> Get in touch</span><span>↗</span></div>
          <p className="auth-preview-foot">Made for whatever you make.</p>
        </div>
        <p className="auth-story-foot"><span aria-hidden="true">↗</span> One page. Plenty of possibilities.</p>
      </aside>
      <section className="auth-form-panel reveal" aria-labelledby="auth-title">
        <div className="auth-form-heading">
          <h1 id="auth-title">{title}</h1>
          <p>{description}</p>
        </div>
        {children}
      </section>
    </div>
  )
}

export function AuthHeader() {
  const { platformName, settings } = useSession()
  const location = useLocation()
  const registering = Boolean(useMatch('/register'))
  const registrationOpen = settings?.settings['platform.registration_open']
  const next = safeNext(new URLSearchParams(location.search).get('next'))
  const destination = registering ? '/login' : '/register'
  return (
    <header className="auth-header">
      <Link to="/" className="auth-brand"><span aria-hidden="true" className="auth-brand-mark">↗</span>{platformName}</Link>
      {registering || registrationOpen === true || registrationOpen === 'true' ? (
        <nav aria-label="Account"><span>{registering ? 'Already have an account?' : 'New here?'}</span><Link className="auth-link" to={`${destination}${next ? `?next=${encodeURIComponent(next)}` : ''}`}>{registering ? 'Sign in' : 'Create an account'}<span aria-hidden="true"> ↗</span></Link></nav>
      ) : null}
    </header>
  )
}
