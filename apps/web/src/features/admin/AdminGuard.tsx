import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useSession } from '../../lib/session'
import { Splash, UnavailableScreen } from '../../components/StatusScreens'
import { isStaff, signedInDestination } from './admin-access'

export function AdminGuard() {
  const session = useSession()
  const location = useLocation()
  if (session.status === 'loading') return <Splash />
  if (session.status === 'unavailable') return <UnavailableScreen />
  if (!session.user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (session.mustChangePassword || session.user.status !== 'active' || session.user.impersonatedBy !== null) return <Navigate to={signedInDestination(session.user)} replace />
  if (!isStaff(session.user)) return <Navigate to="/app/dashboard" replace state={{ adminDenied: true }} />
  return <Outlet />
}
