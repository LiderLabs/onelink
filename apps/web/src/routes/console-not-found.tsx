import { Link, useLocation } from 'react-router-dom'
import { stagger } from '../lib/css'
import { useSession } from '../lib/session'

// ============================================================================
// A 404 INSIDE the console.
//
// `/app/*` needs its own, because the alternative — falling through to the
// public `/:slug` branch — would answer a mistyped console URL with a public
// page lookup, inviting a slug someone could register to catch the typo. The
// console 404 is also the only place that can say "this is a console address and
// there is nothing here", which is more useful than a generic wrong-turn screen.
// ============================================================================

export function ConsoleNotFoundRoute() {
  const session = useSession()
  const location = useLocation()

  return (
    <div className="mx-auto max-w-xl">
      <p className="eyebrow text-danger reveal" style={stagger(0)}>
        {session.platformName} · 404
      </p>
      <h1
        className="reveal mt-3 font-display text-4xl font-medium leading-tight"
        style={stagger(1)}
      >
        No screen at this address
      </h1>
      <p className="reveal mt-5 leading-relaxed text-ink-soft" style={stagger(2)}>
        <span className="break-all font-mono text-sm text-ink">{location.pathname}</span> is inside
        the console, but it does not match a screen. Console paths never fall through to a public
        page, so a mistyped one cannot be answered with somebody's link page.
      </p>
      <p className="reveal mt-7" style={stagger(3)}>
        <Link
          to="/app/profile"
          className="border-b border-transparent font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
        >
          Back to your profile
        </Link>
      </p>
    </div>
  )
}