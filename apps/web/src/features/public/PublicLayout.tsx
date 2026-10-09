import { Link, Outlet, useLocation } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight } from '@phosphor-icons/react'
import { useSession } from '../../lib/session'

// ============================================================================
// The public side of OneLink: the layout `/` + `/:slug` and `/p/:slug` share.
//
// A layout of its own, not `AppShell` minus a few parts. A public page is read by
// an anonymous browser, so it carries none of the session-scoped chrome: no
// suspension notice, no maintenance banner, no masthead with a username in it,
// no console shell. Building it by hiding things inside the console shell
// would make "nothing leaked" a property of the hiding rather than of the layout.
//
// No guard either: this renders for a signed-out visitor and a signed-in one
// alike. A workspace visit retains a return shortcut; anonymous visitors see
// no account navigation or private account details.
// ============================================================================

export function PublicLayout() {
  const { platformName, status } = useSession()
  const location = useLocation()
  const previous = (location.state as { publicPageReturnTo?: unknown } | null)?.publicPageReturnTo
  const returnTo = typeof previous === 'string' && /^\/app\/(?:pages|dashboard|share|onboarding|links|editor)(?:[/?#]|$)/.test(previous)
    ? previous : status === 'authenticated' ? '/app/pages' : null
  const returnLabel = returnTo?.startsWith('/app/pages/') || returnTo?.startsWith('/app/editor') ? 'Back to page editor'
    : returnTo?.startsWith('/app/dashboard') ? 'Back to dashboard'
    : returnTo?.startsWith('/app/share') ? 'Back to Share & QR'
    : returnTo?.startsWith('/app/onboarding') ? 'Back to setup'
    : returnTo?.startsWith('/app/links') ? 'Back to my links' : 'Back to my pages'

  return (
    <div className="public-layout flex flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-[#00d8ef] focus:px-3 focus:py-2 focus:text-sm focus:text-black"
      >
        Skip to content
      </a>

      {returnTo ? <div className="public-return-bar"><Link className="public-return-link" to={returnTo}><ArrowLeft size={17} />{returnLabel}</Link><span>Public page</span></div> : null}

      <main id="main" className="public-page-main">
        <Outlet />
      </main>

      <footer className="public-page-footer">
        <Link to="/login">Sign in to {platformName} <ArrowUpRight size={15} aria-hidden="true" /></Link>
      </footer>
    </div>
  )
}
