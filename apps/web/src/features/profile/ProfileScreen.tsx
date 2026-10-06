import { useEffect, useState } from 'react'
import { useSession } from '../../lib/session'
import { Notice } from '../../components/Notice'
import { Splash } from '../../components/StatusScreens'
import { AccountRecord } from './AccountRecord'
import { ChangePasswordForm } from './ChangePasswordForm'
import { IdentityForm } from './IdentityForm'
import { SocialsEditor } from './SocialsEditor'
import { ProfilePhotoEditor } from './ProfilePhotoEditor'
import { ProfileAvatar } from './ProfileAvatar'
import './profile.css'

// Keep each section's existing resource and session guards together while
// composing the editor and the account summary into one responsive screen.
export function ProfileScreen() {
  const session = useSession()
  const user = session.user
  const [photoBusy, setPhotoBusy] = useState(false)
  useEffect(() => {
    const previous = document.title
    document.title = `Your profile · ${session.platformName}`
    return () => { document.title = previous }
  }, [session.platformName])

  if (!user) return <Splash label="Loading your account" />

  const forced = session.mustChangePassword
  const impersonated = user.impersonatedBy !== null
  const usable = user.status === 'active'
  const readable = usable && !forced
  const blockedReason = !usable
    ? 'Social links are unavailable while your account is restricted.'
    : 'Change your temporary password in the security section to access your social links.'

  return (
    <div className="profile-screen">
      <header className="profile-heading">
        <div className="profile-person">
          <ProfileAvatar avatarKey={user.avatarKey} displayName={user.displayName} />
          <div className="profile-heading-text">
            <p className="profile-kicker">Your profile</p>
            <h1>{user.displayName}</h1>
            <p className="profile-handle">@{user.username}</p>
          </div>
        </div>
        <p className="profile-heading-copy">The details that make<br className="hidden sm:block" /> this space yours.</p>
      </header>

      {impersonated ? <Notice tone="warning" label="Read-only support session">
        You are viewing this account as an administrator. Profile details and social links are read-only.
      </Notice> : null}
      {forced ? <Notice tone="warning" label="Password change required">
        Set a new password in the security section below to finish setting up your account. This browser will stay signed in.
      </Notice> : null}
      {!usable ? <Notice tone="error" label={`Account ${user.status}`}>
        Your account is restricted. You can view your account details here, but changes are unavailable.
      </Notice> : null}

      <div className="profile-content">
        <div className="profile-editors">
          <ProfilePhotoEditor user={user} readable={readable} writable={readable && !impersonated} onBusyChange={setPhotoBusy} />
          <IdentityForm user={user} disabled={!usable || forced || impersonated} navigationLocked={photoBusy} />
          <SocialsEditor readable={readable} writable={readable && !impersonated} blockedReason={blockedReason} />
          <section className="profile-section profile-security" aria-labelledby="security">
            <div className="profile-section-heading">
              <div>
                <p className="profile-section-number" aria-hidden="true">04</p>
                <h2 id="security">Security</h2>
              </div>
              <span className="profile-section-note">Keep your account yours</span>
            </div>
            <p className="profile-section-description">
              Update your password here. Your other sessions will be signed out; this browser stays signed in.
            </p>
            <ChangePasswordForm forced={forced} />
          </section>
        </div>
        <aside className="profile-summary" aria-label="Your account">
          <AccountRecord user={user} capabilities={session.capabilities} />
          <nav className="profile-jump-nav" aria-label="Profile sections">
            <p>On this page</p>
            <a href="#photo">Profile photo <span aria-hidden="true">↗</span></a>
            <a href="#identity">Profile details <span aria-hidden="true">↗</span></a>
            <a href="#socials">Social links <span aria-hidden="true">↗</span></a>
            <a href="#security">Security <span aria-hidden="true">↗</span></a>
          </nav>
        </aside>
      </div>
    </div>
  )
}
