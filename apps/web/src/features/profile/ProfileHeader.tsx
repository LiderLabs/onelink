import { Link } from 'react-router-dom'
import { ConsoleNav } from '../../components/ConsoleNav'
import { useSession } from '../../lib/session'

export function ProfileHeader() {
  const { platformName, user, logout } = useSession()
  return (
    <header className="profile-masthead">
      <div className="profile-masthead-inner">
        <div className="profile-brand-nav">
          <Link to="/" className="auth-brand">
            <span aria-hidden="true" className="auth-brand-mark">↗</span>{platformName}
          </Link>
          <ConsoleNav compact />
        </div>
        <div className="profile-session">
          {user ? <span>{user.displayName}</span> : null}
          {user ? <button type="button" className="auth-link" onClick={() => void logout()}>Sign out</button> : null}
        </div>
      </div>
    </header>
  )
}
