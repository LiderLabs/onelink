import { useLocation, Navigate, Outlet } from 'react-router-dom'
import { useSession } from '../lib/session'
import { Splash, UnavailableScreen } from './StatusScreens'

// ============================================================================
// Route guards.
//
// These read the four-state session rather than a boolean, because the
// difference between "we do not know yet", "signed out" and "could not ask" is
// the difference between a splash, a login form and an explanation screen.
// Collapsing them would mean showing a login form to a signed-in user during the
// bootstrap, or telling a user their password failed when the API was simply
// unreachable.
// ============================================================================

/**
 * Only same-origin absolute paths are accepted as a post-login destination.
 *
 * `?next=` arrives from the URL, so without this an attacker could send someone
 * to `/login?next=https://evil.example` and the app would hand them off after a
 * genuine sign-in — a phishing pivot that looks completely legitimate. `//host`
 * is rejected too, because browsers read protocol-relative URLs as absolute.
 */
export function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null
  return raw
}

/** Everything a signed-in session is required for. */

/**
 * The profile screen is the one console surface a restricted session may reach.
 *
 * Editing used to live on the dashboard (`/app`), so that is where the interlock
 * sent a session that must change its password, or is pending/suspended, or is
 * being impersonated. The dashboard is now a read-only overview and the profile
 * plus its security section moved into the merged editor, so this is the address
 * that carries the forced-password form, the impersonation notice and the
 * account explanation. Restricted sessions are routed here and nowhere else.
 */
const PROFILE_EDITOR_PATH = '/app/editor/profile'

export function RequireAuth() {
  const session = useSession()
  const location = useLocation()

  if (session.status === 'loading') return <Splash />
  if (session.status === 'unavailable') return <UnavailableScreen />
  if (!session.user) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`)
    return <Navigate to={`/login?next=${next}`} replace />
  }
  const restricted =
    session.mustChangePassword ||
    session.user.status !== 'active' ||
    session.user.impersonatedBy !== null
  if (restricted && location.pathname !== PROFILE_EDITOR_PATH) {
    return <Navigate to={PROFILE_EDITOR_PATH} replace />
  }

  return <Outlet />
}

/** The sign-in / sign-up screens: pointless for someone already signed in. */
export function RequireAnonymous() {
  const session = useSession()
  const location = useLocation()

  if (session.status === 'loading') return <Splash />
  if (session.status === 'unavailable') return <UnavailableScreen />
  if (session.user) {
    const next = safeNext(new URLSearchParams(location.search).get('next'))
    return <Navigate to={next ?? '/app'} replace />
  }

  return <Outlet />
}
