import { Link, Outlet, useMatch } from 'react-router-dom'
import { useSession } from '../lib/session'
import { SuspendedNotice } from './SuspendedNotice'
import { AuthHeader } from './AuthPage'

// ============================================================================
// Page chrome for every route: masthead, any blocking advisory, and the footer.
//
// Three cross-cutting advisories live here rather than on individual screens,
// because they are properties of the session, not of a screen:
//
//   * maintenance mode (from public settings, so it shows even when signed out)
//   * a suspended account, with the reason and the end date when there is one
//
// Keeping them in the shell means no screen can forget to render them.
// ============================================================================

export function AppShell() {
  const { status, user, platformName, settings, logout } = useSession()
  const loginMatch = useMatch('/login')
  const registerMatch = useMatch('/register')
  const authPage = Boolean(loginMatch || registerMatch)
  const maintenanceSetting = settings?.settings['platform.maintenance_mode']
  const maintenanceEnabled = maintenanceSetting === true || maintenanceSetting === 'true'
  const maintenanceMessage = settings?.settings['platform.maintenance_message']

  return (
    <div className={`flex min-h-screen flex-col${authPage ? ' auth-shell' : ' console-page'}`}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-ink focus:px-3 focus:py-2 focus:font-mono focus:text-xs focus:uppercase focus:text-paper"
      >
        Skip to content
      </a>

      {authPage ? <AuthHeader /> : <header className="border-b border-rule bg-paper/95 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-6">
          <Link to="/" className="inline-flex items-center gap-3 font-display text-[1.7rem] font-medium leading-none tracking-tight text-ink">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-ink bg-paper-deep font-sans text-sm font-semibold text-ink">B</span>
            {platformName}
            <span className="align-super font-mono text-[0.625rem] uppercase tracking-[0.18em] text-ink-faint">
              beta
            </span>
          </Link>

          <div className="flex items-center gap-4 text-right">
            {status === 'loading' ? (
              <p className="eyebrow">Checking session</p>
            ) : user ? (
              <>
                <p className="eyebrow">
                  {user.username} <span aria-hidden="true">·</span> {user.role}
                  {user.impersonatedBy ? ' · impersonated' : ''}
                </p>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="border-b border-transparent font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
                >
                  Sign out
                </button>
              </>
            ) : (
              <p className="eyebrow">Not signed in</p>
            )}
          </div>
        </div>
      </header>}

      {maintenanceEnabled ? (
        <div role="status" className="border-b border-rule bg-paper-deep">
          <p className="mx-auto max-w-7xl px-4 py-3 text-sm text-ink-soft sm:px-6">
            <span className="eyebrow mr-3 text-ink-faint">Read-only</span>
            {typeof maintenanceMessage === 'string' && maintenanceMessage.length > 0
              ? maintenanceMessage
              : 'OneLink is in maintenance mode. You can sign in, but changes are paused.'}
          </p>
        </div>
      ) : null}

      {user ? (
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
          <SuspendedNotice user={user} />
        </div>
      ) : null}

      <main id="main" className={authPage ? 'auth-main' : 'mx-auto w-full max-w-7xl flex-1 px-4 py-7 sm:px-6 sm:py-9'}>
        <Outlet />
      </main>

      {authPage ? <footer className="auth-footer">{platformName} · A home for your links.</footer> : <footer className="border-t border-rule bg-paper-deep/80">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
          <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-faint">
            {platformName} · console
          </p>
          <p className="font-mono text-[0.6875rem] tracking-[0.06em] text-ink-soft">
            sessions end 8 h after sign-in
          </p>
        </div>
      </footer>}
    </div>
  )
}
