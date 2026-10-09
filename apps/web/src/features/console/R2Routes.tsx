import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Info } from '@phosphor-icons/react'
import { useSession } from '../../lib/session'

// The console's Release 2 surfaces.
//
// `/app/settings` is the workspace settings hub: it names each setting the
// current API actually stores and links to the screen that owns it, so the
// creator sidebar's "Settings" entry has a real destination rather than a dead
// link. Analytics has a screen of its own (`/app/analytics`). Only the
// submissions inbox is still unbuilt, and it states that plainly instead of
// fabricating records.
//
// Nothing here renders a control for a setting that cannot be saved — a switch
// that silently discards a click is worse than an honest "unavailable".

const SETTINGS_LINKS = [
  { title: 'Page address & publishing', description: 'Rename your page address, review the private draft, and publish when you are ready.', to: '/app/editor', action: 'Open the page editor' },
  { title: 'Profile, photo & socials', description: 'Your display name, biography, profile photo, and social handles — shared by every page you own.', to: '/app/profile', action: 'Edit your profile' },
  { title: 'Password & security', description: 'Change your password and read the account record behind your sign-in.', to: '/app/profile#security', action: 'Review security' },
  { title: 'Sharing & QR', description: 'Copy your page address, share it natively where the browser offers it, and download a QR code.', to: '/app/share', action: 'Share your page' },
  { title: 'Analytics collection', description: 'Visitor tracking is off. Views, clicks, referrers, and countries are not recorded yet.', to: '/app/analytics', action: 'See what is unavailable' },
]

const DEFERRED_SETTINGS = [
  { title: 'Custom domain', description: 'Connecting a domain, verifying DNS, and issuing TLS are not built. Your OneLink address stays the only active address.' },
  { title: 'Contact form & submissions', description: 'The API accepts no contact-form submissions, so there is no inbox to configure and no visitor message is stored.' },
  { title: 'Team access', description: 'Invitations and page roles are not implemented. Page changes are owner-only.' },
]

export function SettingsRoute() {
  const { platformName } = useSession()
  useEffect(() => { document.title = `Settings · ${platformName}` }, [platformName])

  return (
    <section className="creator-settings">
      <header className="creator-heading">
        <div>
          <p className="creator-eyebrow">Your workspace</p>
          <h1>Settings</h1>
          <p>Everything OneLink can save today, and the screen that owns it. No setting is stored in two places.</p>
        </div>
      </header>

      <section aria-labelledby="settings-available-heading">
        <h2 id="settings-available-heading" className="creator-eyebrow">Available now</h2>
        <div className="creator-stack creator-settings-list">
          {SETTINGS_LINKS.map((item) => (
            <article key={item.title} className="creator-card creator-settings-row">
              <div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
              <Link className="creator-button" to={item.to}>{item.action}</Link>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="settings-deferred-heading" className="creator-settings-section">
        <h2 id="settings-deferred-heading" className="creator-eyebrow">Not available yet</h2>
        <div className="creator-stack creator-settings-list">
          {DEFERRED_SETTINGS.map((item) => (
            <article key={item.title} className="creator-card creator-settings-row">
              <div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
              <span className="creator-badge creator-badge-private">Unavailable</span>
            </article>
          ))}
        </div>
      </section>

      <div className="creator-notice creator-settings-section">
        <Info size={18} weight="light" />
        <p>No switch is shown for a feature that cannot be saved. The settings above are the only ones the current API accepts.</p>
      </div>
    </section>
  )
}
export function SubmissionsRoute() {
  const { platformName } = useSession()
  useEffect(() => { document.title = `Submissions · ${platformName}` }, [platformName])

  return (
    <section className="mx-auto max-w-7xl">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink pb-7">
        <div>
          <p className="eyebrow">A later release</p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight sm:text-4xl">Submissions</h1>
        </div>
        <button type="button" disabled className="min-h-11 border border-rule px-4 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-faint disabled:cursor-not-allowed">Export CSV · unavailable</button>
      </div>
      <div role="status" className="mt-7 border border-dashed border-rule bg-white/80 p-5 sm:p-7">
        <p className="font-display text-xl sm:text-2xl">Contact collection is not available yet.</p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-soft">
          The current API does not accept contact-form submissions, so this inbox contains no records. The search, filters, unread status, and export controls shown in the mockup will become active with the Release 2 contact feature.
        </p>
        <Link to="/app/settings" className="mt-5 inline-block font-mono text-[0.6875rem] uppercase tracking-[0.12em] underline underline-offset-4">View feature availability</Link>
      </div>
    </section>
  )
}
