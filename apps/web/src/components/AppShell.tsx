import { Link, Outlet } from 'react-router-dom'
import { useSession } from '../lib/session'
import { SuspendedNotice } from './SuspendedNotice'

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

  const maintenanceEnabled = settings?.settings['platform.maintenance_mode'] === 'true'
  const maintenanceMessage = settings?.settings['platform.maintenance_message']

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-ink focus:px-3 focus:py-2 focus:font-mono focus:text-xs focus:uppercase focus:text-paper"
      >
        Skip to content
      </a>

      <header className="border-b border-rule">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-end justify-between gap-x-6 gap-y-3 px-5 py-5">
          <Link to="/" className="font-display text-[1.75rem] font-medium leading-none tracking-tight">
            {platformName}
            <span className="ml-2 align-super font-mono text-[0.625rem] uppercase tracking-[0.18em] text-ink-faint">
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
      </header>

      {maintenanceEnabled ? (
        <div role="status" className="border-b border-ink/15 bg-ink/5">
          <p className="mx-auto max-w-5xl px-5 py-3 text-sm text-ink">
            <span className="eyebrow mr-3 text-ink">Read-only</span>
            {maintenanceMessage && maintenanceMessage.length > 0
              ? maintenanceMessage
              : 'OneLink is in maintenance mode. You can sign in, but changes are paused.'}
          </p>
        </div>
      ) : null}

      {user ? (
        <div className="mx-auto w-full max-w-5xl px-5">
          <SuspendedNotice user={user} />
        </div>
      ) : null}

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-5 py-12 sm:py-16">
        <Outlet />
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-5">
          <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-faint">
            {platformName} · admin console
          </p>
          <p className="font-mono text-[0.6875rem] tracking-[0.06em] text-ink-faint">
            sessions end 8 h after sign-in
          </p>
        </div>
      </footer>
    </div>
  )
}
