import { useEffect, useState } from 'react'
import { useSession } from '../../lib/session'
import { Notice } from '../../components/Notice'
import { Splash } from '../../components/StatusScreens'
import { AccountRecord } from './AccountRecord'
import { ChangePasswordForm } from './ChangePasswordForm'
import { IdentityForm } from './IdentityForm'
import { SocialsEditor } from './SocialsEditor'
import { ProfilePhotoEditor } from './ProfilePhotoEditor'
import { ProfilePreview } from './ProfilePreview'
import type { PreviewIdentity, PreviewPhoto, PreviewSocials } from './ProfilePreview'
import './profile.css'

export function ProfileScreen() {
  const session = useSession()
  const user = session.user
  const [photoBusy, setPhotoBusy] = useState(false)
  const [previewIdentity, setPreviewIdentity] = useState<PreviewIdentity | null>(null)
  const [previewPhoto, setPreviewPhoto] = useState<PreviewPhoto | null>(null)
  const [previewSocials, setPreviewSocials] = useState<PreviewSocials>({ links: [], loading: true, unavailable: false })

  useEffect(() => {
    document.title = `Profile · ${session.platformName}`
  }, [session.platformName])

  if (!user) return <Splash label="Loading your account" />

  const forced = session.mustChangePassword
  const impersonated = user.impersonatedBy !== null
  const usable = user.status === 'active'
  const readable = usable && !forced
  const blockedReason = !usable
    ? 'Social links are unavailable while your account is restricted.'
    : 'Change your temporary password in the security section below to access your social links.'

  return (
    <div className="profile-screen" id="profile-editor">
      <div className="profile-content">
        <div className="profile-editors">
          {impersonated ? <Notice tone="warning" label="Read-only support session">
            You are viewing this account as an administrator. Profile details and social links are read-only.
          </Notice> : null}
          {forced ? <Notice tone="warning" label="Password change required">
            Set a new password in the security section below to finish setting up your account. This browser will stay signed in.
          </Notice> : null}
          {!usable ? <Notice tone="error" label={`Account ${user.status}`}>
            Your account is restricted. You can view your account details here, but changes are unavailable.
          </Notice> : null}

          <ProfilePhotoEditor user={user} readable={readable} writable={readable && !impersonated} onBusyChange={setPhotoBusy} onPreviewChange={setPreviewPhoto} />
          <IdentityForm user={user} disabled={!usable || forced || impersonated} navigationLocked={photoBusy} onPreviewChange={setPreviewIdentity} />
          <SocialsEditor readable={readable} writable={readable && !impersonated} blockedReason={blockedReason} onPreviewChange={setPreviewSocials} />
          <section className="profile-section profile-security" aria-labelledby="security">
            <div className="profile-section-heading">
              <div>
                <p className="profile-section-number" aria-hidden="true">03</p>
                <h2 id="security">Security</h2>
              </div>
              <span className="profile-section-note">Keep your account yours</span>
            </div>
            <p className="profile-section-description">
              {usable
                ? 'Update your password here. Your other sessions will be signed out; this browser stays signed in.'
                : 'Password changes are unavailable while your account is restricted.'}
            </p>
            <ChangePasswordForm forced={forced} disabled={!usable} />
          </section>
        </div>
        <aside className="profile-summary" aria-label="Public profile preview">
          <ProfilePreview identity={previewIdentity ?? user} avatarKey={user.avatarKey} photo={previewPhoto} socials={previewSocials} />
          <details className="mt-6 border-t border-rule pt-5">
            <summary className="eyebrow cursor-pointer">Account and session details</summary>
            <div className="mt-4"><AccountRecord user={user} capabilities={session.capabilities} sessionOnly /></div>
          </details>
        </aside>
      </div>
    </div>
  )
}
