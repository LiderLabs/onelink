import { Link, NavLink } from 'react-router-dom'
import type { Dispatch, SetStateAction } from 'react'
import { createContext } from 'react'
import { useSession } from '../../lib/session'
import { ProfileAvatar } from './ProfileAvatar'

export interface ProfileNavigationState {
  photoBusy: boolean
  setPhotoBusy: Dispatch<SetStateAction<boolean>>
}
export const ProfileNavigationContext = createContext<ProfileNavigationState | null>(null)

export function ProfileHeader({ navigationLocked = false }: { navigationLocked?: boolean }) {
  const { platformName, user, logout } = useSession()
  return (
    <header className="profile-masthead">
      <div className="profile-masthead-inner">
        <div className="profile-brand-nav">
          <Link to="/" className="auth-brand">
            <span aria-hidden="true" className="auth-brand-mark">↗</span>{platformName}
          </Link>
          <nav className="console-top-nav profile-top-nav" aria-label="Account pages">
            {(['profile', 'socials'] as const).map(page => <NavLink key={page} to={`/app/${page}`}
              aria-disabled={navigationLocked || undefined} tabIndex={navigationLocked ? -1 : undefined}
              onClick={event => { if (navigationLocked) event.preventDefault() }}>
              {page === 'profile' ? 'Profile' : 'Socials'}
            </NavLink>)}
          </nav>
        </div>
        <div className="profile-session">
          {user ? <Link to="/app/profile" className="profile-session-account" aria-label={`Account: @${user.username}`}
            onClick={event => { if (navigationLocked) event.preventDefault() }} aria-disabled={navigationLocked || undefined}>
            <ProfileAvatar avatarKey={user.avatarKey} displayName={user.displayName} className="profile-nav-avatar" />
            <span className="profile-nav-username">@{user.username}</span>
          </Link> : null}
          {user ? <button type="button" className="auth-link" onClick={() => void logout()}>Sign out</button> : null}
        </div>
      </div>
    </header>
  )
}
