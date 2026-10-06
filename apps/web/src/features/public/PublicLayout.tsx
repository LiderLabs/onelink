import { Link, Outlet } from 'react-router-dom'
import { useSession } from '../../lib/session'

// ============================================================================
// The public side of OneLink: the layout `/` + `/:slug` and `/p/:slug` share.
//
// A layout of its own, not `AppShell` minus a few parts. A public page is read by
// an anonymous browser, so it carries none of the session-scoped chrome: no
// suspension notice, no maintenance banner, no masthead with a username in it,
// no console navigation. Building it by hiding things inside the console shell
// would make "nothing leaked" a property of the hiding rather than of the layout.
//
// No guard either: this renders for a signed-out visitor and a signed-in one
// alike, and the session is read only for the platform name in the footer.
// ============================================================================

export function PublicLayout() {
  const { platformName } = useSession()

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-ink focus:px-3 focus:py-2 focus:font-mono focus:text-xs focus:uppercase focus:text-paper"
      >
        Skip to content
      </a>

      <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-5 py-16 sm:py-20">
        <Outlet />
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-faint">
            {platformName}
          </p>
          <Link
            to="/login"
            className="border-b border-transparent font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
          >
            Sign in
          </Link>
        </div>
      </footer>
    </div>
  )
}