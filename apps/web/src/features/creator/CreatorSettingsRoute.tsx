import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import { ArrowRight, Bell, Check, EnvelopeSimple, Gear, Info, LockKey, Monitor, Palette, ShieldCheck, SignOut, Trash, UserCircle } from '@phosphor-icons/react'
import { useSession } from '../../lib/session'
import { formatDateTime } from '../../lib/css'
import { Splash } from '../../components/StatusScreens'
import { Notice } from '../../components/Notice'
import { ProfileAvatar } from '../profile/ProfileAvatar'
import { ProfilePhotoEditor } from '../profile/ProfilePhotoEditor'
import { IdentityForm } from '../profile/IdentityForm'
import { SocialsEditor } from '../profile/SocialsEditor'
import { ChangePasswordForm } from '../profile/ChangePasswordForm'
import { AccountRecord } from '../profile/AccountRecord'
import { DEFAULT_APPEARANCE, useWorkspaceAppearance } from './workspace-appearance'
import '../profile/profile.css'
import './creator-settings.css'

const sections = [
  { id: 'profile', label: 'Profile', title: 'Profile information', description: 'Update your account photo and the details people see on your public pages.', icon: UserCircle, group: 'Profile & security' },
  { id: 'security', label: 'Password & security', title: 'Password & security', description: 'Protect your account, update your password, and manage device access.', icon: LockKey, group: 'Profile & security' },
  { id: 'sessions', label: 'Active sessions', title: 'Active sessions', description: 'Review the session for this browser and keep your account secure.', icon: Monitor, group: 'Profile & security' },
  { id: 'notifications', label: 'Notifications', title: 'Notifications', description: 'Control how you hear from OneLink.', icon: Bell, group: 'Preferences' },
  { id: 'appearance', label: 'Appearance', title: 'Appearance', description: 'Make your workspace comfortable while keeping the OneLink cyan look.', icon: Palette, group: 'Preferences' },
  { id: 'delete-account', label: 'Delete account', title: 'Delete account', description: 'Manage your account and understand your deletion options.', icon: Trash, group: 'Advanced' },
] as const

export function LegacyProfileRedirect() {
  const { hash } = useLocation()
  return <Navigate replace to={hash === '#security' ? '/app/settings/security' : hash === '#sessions' ? '/app/settings/sessions' : `/app/settings/profile${hash === '#socials' ? hash : ''}`} />
}

function AppearanceSettings() {
  const { user } = useSession()
  const { appearance, save } = useWorkspaceAppearance(user?.id)
  const [message, setMessage] = useState('Changes apply instantly and are saved in this browser.')
  const update = (next: typeof appearance) => {
    setMessage(save(next) ? 'Appearance saved in this browser.' : 'Your browser could not save these preferences. Allow local storage and try again.')
  }
  return <div className="creator-settings-stack">
    <section className="creator-card">
      <div className="creator-settings-card-heading"><Palette size={22} /><div><h3>Workspace color</h3><p>Two dark finishes. The same cyan accent.</p></div></div>
      <div className="creator-settings-options" aria-label="Workspace color">
        {(['charcoal', 'midnight'] as const).map(tone => <button type="button" key={tone} aria-label={tone === 'charcoal' ? 'Charcoal' : 'Midnight'} aria-pressed={appearance.tone === tone} onClick={() => update({ ...appearance, tone })} className="creator-settings-option">
          <span className={`creator-settings-swatch is-${tone}`} aria-hidden="true"><span /><span /><span /></span>
          <span>{tone === 'charcoal' ? 'Charcoal' : 'Midnight'}</span>{appearance.tone === tone ? <Check size={16} /> : null}
        </button>)}
      </div>
    </section>
    <section className="creator-card">
      <div className="creator-settings-card-heading"><Gear size={22} /><div><h3>Workspace spacing</h3><p>Choose how much room your navigation and cards use.</p></div></div>
      <div className="creator-settings-segment" aria-label="Workspace spacing">{(['comfortable', 'compact'] as const).map(density => <button type="button" key={density} aria-pressed={appearance.density === density} onClick={() => update({ ...appearance, density })}>{density === 'comfortable' ? 'Comfortable' : 'Compact'}</button>)}</div>
      <label className="creator-settings-preference"><span><strong>Reduce motion</strong><small>Limit workspace animations and transitions.</small></span><input type="checkbox" aria-label="Reduce motion" checked={appearance.motion === 'reduced'} onChange={event => { const checked = event.currentTarget.checked; update({ ...appearance, motion: checked ? 'reduced' : 'system' }) }} /></label>
    </section>
    <div className="creator-settings-footer"><p role="status">{message}</p><button type="button" className="creator-button" onClick={() => update(DEFAULT_APPEARANCE)}>Reset appearance</button></div>
    <p className="creator-notice"><Info size={18} />These preferences apply to your workspace on this browser. Customize your public page in the Page editor.</p>
  </div>
}

export function SettingsRoute() {
  const session = useSession()
  const { section = 'profile' } = useParams()
  const { hash } = useLocation()
  const [photoBusy, setPhotoBusy] = useState(false)
  const current = sections.find(item => item.id === section)
  const user = session.user
  useEffect(() => { document.title = `${current?.title ?? 'Settings'} · ${session.platformName}` }, [current?.title, session.platformName])
  useEffect(() => {
    if (hash === '#socials' && section === 'profile') document.getElementById('socials')?.scrollIntoView()
    else window.scrollTo({ top: 0, behavior: 'instant' })
  }, [section, hash])
  if (!user) return <Splash label="Loading account settings" />
  if (!current) return <Navigate to="/app/settings/profile" replace />
  const active = user.status === 'active'
  const readable = active && !session.mustChangePassword
  const writable = readable && user.impersonatedBy === null
  const name = user.displayName || user.username
  const Icon = current.icon
  return <section className="creator-settings">
    <header className="creator-heading"><div><p className="creator-eyebrow">Your account · privacy & control</p><h1>Settings</h1><p>Manage your personal information, account protection, and workspace preferences.</p></div><span className="creator-badge"><ShieldCheck size={15} />Your account</span></header>
    <div className="creator-settings-layout">
      <nav className="creator-settings-nav" aria-label="Account settings">
        {['Profile & security', 'Preferences', 'Advanced'].map(group => <div className="creator-settings-nav-group" key={group}><p>{group}</p>{sections.filter(item => item.group === group).map(({ id, label, icon: SectionIcon }) => <Link key={id} to={`/app/settings/${id}`} aria-current={section === id ? 'page' : undefined}><SectionIcon size={19} />{label}</Link>)}</div>)}
      </nav>
      <div className="creator-settings-content">
        <div className="creator-settings-section-heading"><div><h2><Icon size={23} />{current.title}</h2><p>{current.description}</p></div><span>{String(sections.indexOf(current) + 1).padStart(2, '0')} / Account</span></div>
        {user.impersonatedBy !== null ? <Notice tone="warning" label="Read-only support session">Profile edits are unavailable during an administrator support session.</Notice> : null}
        {!active ? <Notice tone="warning" label={`Account ${user.status}`}>Your account is restricted. You can review your details, but account changes are unavailable.</Notice> : null}
        {session.mustChangePassword ? <Notice tone="warning" label="Password change required">Set a new password in <Link className="creator-text-link" to="/app/settings/security">Password & security</Link> to enable profile changes.</Notice> : null}

        {section === 'profile' ? <div className="creator-settings-stack">
          <div className="creator-settings-account"><ProfileAvatar avatarKey={user.avatarKey} displayName={name} className="creator-settings-avatar" /><div><h3>{name}</h3><p>{user.email}</p><Link to="/app/pages">Manage your page addresses <ArrowRight size={14} /></Link></div><span className="creator-badge creator-badge-live">{user.status}</span></div>
          <section className="creator-card creator-legacy creator-settings-profile"><div className="creator-settings-card-heading"><UserCircle size={22} /><div><h3>Personal details</h3><p>Your photo and profile details are shared across your public pages.</p></div></div>
            <ProfilePhotoEditor compact user={user} readable={readable} writable={writable} onBusyChange={setPhotoBusy} />
            <IdentityForm user={user} disabled={!writable} navigationLocked={photoBusy} />
          </section>
          <section className="creator-card"><div className="creator-settings-card-heading"><EnvelopeSimple size={22} /><div><h3>Email address</h3><p>The address associated with your OneLink account.</p></div></div><div className="creator-settings-detail-row"><strong>{user.email}</strong><span className="creator-badge">{user.emailVerified ? 'Verified' : 'Not verified'}</span></div><p className="creator-settings-help">Email changes are managed by the platform team.</p></section>
          <section className="creator-card creator-legacy creator-settings-socials"><SocialsEditor compact readable={readable} writable={writable} blockedReason="Social profiles become available when your account is active and your password is up to date." /></section>
          <section className="creator-card"><div className="creator-settings-card-heading"><ShieldCheck size={22} /><div><h3>Quick security access</h3><p>Account protection is one click away.</p></div></div><div className="creator-settings-shortcuts"><Link to="/app/settings/security"><LockKey size={23} /><strong>Password & security</strong><span>Update your password and protect your account.</span></Link><Link to="/app/settings/sessions"><Monitor size={23} /><strong>Active sessions</strong><span>Review your current browser’s access.</span></Link></div></section>
        </div> : null}

        {section === 'security' ? <div className="creator-settings-stack">
          <div className="creator-settings-banner"><ShieldCheck size={27} /><div><strong>Protect your OneLink account</strong><p>Use a unique password. Changing it signs out your other sessions and keeps this browser signed in.</p></div></div>
          <section className="creator-card creator-legacy creator-settings-password"><div className="creator-settings-card-heading"><LockKey size={22} /><div><h3>Change password</h3><p>Enter your current password and choose a new one.</p></div></div><ChangePasswordForm forced={session.mustChangePassword} disabled={!active} /></section>
          <section className="creator-card"><div className="creator-settings-detail-row"><div><h3>Sessions & device access</h3><p className="creator-settings-help">Review this browser’s session or update your password to sign out other devices.</p></div><Link className="creator-button" to="/app/settings/sessions">Manage sessions <ArrowRight size={17} /></Link></div></section>
        </div> : null}

        {section === 'sessions' ? <div className="creator-settings-stack">
          <p className="creator-notice"><Info size={18} />This page shows your current browser session. A list of other devices and individual session revocation are not available yet.</p>
          <section className="creator-card"><div className="creator-settings-card-heading"><Monitor size={23} /><div><h3>This device</h3><p>Your current signed-in browser.</p></div><span className="creator-badge creator-badge-live">Current session</span></div><div className="creator-settings-detail-row"><div><strong>Signed in as @{user.username}</strong><p className="creator-settings-help">Session expires {formatDateTime(user.sessionExpiresAt)}</p></div><button type="button" className="creator-button" onClick={() => void session.logout()}><SignOut size={17} />Sign out this device</button></div></section>
          <div className="creator-settings-session-record"><AccountRecord user={user} capabilities={session.capabilities} sessionOnly /></div>
          <div className="creator-settings-banner"><ShieldCheck size={24} /><div><strong>Keep your account secure</strong><p>If you suspect another device has access, changing your password ends its session.</p></div><Link className="creator-button" to="/app/settings/security">Update password <ArrowRight size={16} /></Link></div>
        </div> : null}

        {section === 'notifications' ? <div className="creator-settings-stack">
          <p className="creator-notice"><Info size={18} />Notification preferences are not available yet.</p>
          <section className="creator-card"><div className="creator-settings-card-heading"><Bell size={23} /><div><h3>Email notifications</h3><p>Account alerts and creator updates.</p></div><span className="creator-badge">Unavailable</span></div><div className="creator-settings-preference"><span><strong>Sign-in alerts</strong><small>Notifications when a new device accesses your account.</small></span><LockKey size={18} /></div><div className="creator-settings-preference"><span><strong>Creator updates</strong><small>News and updates about your OneLink workspace.</small></span><LockKey size={18} /></div><p className="creator-settings-help">Your account currently has no notification controls. Preferences will appear here when this feature is available.</p></section>
        </div> : null}

        {section === 'appearance' ? <AppearanceSettings /> : null}

        {section === 'delete-account' ? <div className="creator-settings-stack">
          <section className="creator-card creator-settings-danger"><div className="creator-settings-card-heading"><Trash size={24} /><div><h3>Delete your OneLink account</h3><p>Deleting an account removes access to its profile and workspace.</p></div></div><p className="creator-settings-help">Account deletion is not available from your workspace yet. You can delete individual pages from My pages, or sign out of this device.</p><div className="creator-settings-danger-footer"><p id="account-deletion-unavailable">Self-service account deletion is unavailable.</p><button type="button" disabled aria-describedby="account-deletion-unavailable" className="creator-button"><Trash size={17} />Delete account</button></div></section>
          <section className="creator-card"><h3>Manage your pages</h3><p className="creator-settings-help">Review your published pages and remove any you no longer want to share.</p><Link className="creator-button mt-5" to="/app/pages">Go to My pages <ArrowRight size={17} /></Link></section>
        </div> : null}
      </div>
    </div>
  </section>
}
