import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Splash } from '../../components/StatusScreens'
import { useSession } from '../../lib/session'
import type { OwnerPage } from '../../lib/types'
import { listMyPages } from '../pages/api'

function DeferredCard({ title, description }: { title: string; description: string }) {
  return (
    <article className="flex flex-col justify-between gap-5 border border-rule bg-white/80 p-5 sm:p-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-medium">{title}</h2>
          <span className="stamp text-ink-faint">Unavailable · Release 2</span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">{description}</p>
      </div>
      <p className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-ink-faint">No settings are saved and no data is collected for this feature.</p>
    </article>
  )
}

export function AnalyticsRoute() {
  const { platformName } = useSession()
  useEffect(() => { document.title = `Analytics · ${platformName}` }, [platformName])

  return (
    <section className="mx-auto max-w-7xl">
      <div className="border-b border-ink pb-7">
        <p className="eyebrow">A later release</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight sm:text-4xl">Analytics</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-soft">
          This screen is a preview of the planned analytics area. OneLink does not currently record page views, link clicks, referrers, or visitor details, so it cannot show trustworthy metrics yet.
        </p>
      </div>

      <div role="status" className="mt-7 border-l-2 border-ink pl-4">
        <p className="font-medium">Analytics are unavailable until Release 2.</p>
        <p className="mt-1 text-sm text-ink-soft">No tracking has been enabled. Nothing is being estimated or filled with sample data.</p>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {['Page views', 'Link clicks', 'Click-through rate', 'Unique visitors'].map((label) => (
          <article key={label} className="border border-rule bg-white/80 p-4">
            <p className="eyebrow">{label}</p><p className="mt-3 font-display text-xl text-ink-faint">Not collected</p>
          </article>
        ))}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <DeferredCard title="Views & clicks over time" description="A time-series chart will appear after event collection and the analytics API are available." />
        <DeferredCard title="Top links & referrers" description="Link rankings and referral sources are not available because clicks and referrers are not recorded." />
        <DeferredCard title="Countries & devices" description="Visitor location and device breakdowns are not collected or inferred." />
        <DeferredCard title="Export" description="There is no analytics dataset to export in this release." />
      </div>
    </section>
  )
}

export function SettingsRoute() {
  const { platformName } = useSession()
  const [pages, setPages] = useState<OwnerPage[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    document.title = `Settings · ${platformName}`
    let current = true
    setPages(null)
    setError(null)
    void listMyPages(1, 100).then((result) => {
      if (current) setPages(result.items)
    }).catch((cause: unknown) => {
      if (current) setError(cause)
    })
    return () => { current = false }
  }, [platformName, retry])

  return (
    <section className="mx-auto max-w-7xl">
      <div className="border-b border-ink pb-7">
        <p className="eyebrow">Account & page settings</p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight sm:text-4xl">Settings</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-soft">
          Profile details and page addresses are managed in the existing editors. Custom domains, contact collection, and team access are not available yet.
        </p>
      </div>

      <section aria-labelledby="addresses-heading" className="mt-8">
        <div className="border-b border-rule pb-3">
          <p className="eyebrow">Available now</p><h2 id="addresses-heading" className="mt-1 font-display text-2xl">Page addresses</h2>
        </div>
        {pages === null && error === null ? <Splash label="Loading page addresses" /> : null}
        {error ? <ErrorNotice error={error} action="Load page addresses again" onRetry={() => setRetry((value) => value + 1)} /> : null}
        {pages?.length === 0 ? <p className="mt-4 text-sm text-ink-soft">Create a page to manage its address.</p> : null}
        {pages?.length ? (
          <ul className="mt-3 divide-y divide-rule border-y border-rule">
            {pages.map((page) => (
              <li key={page.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="min-w-0"><p className="wrap-break-word font-medium">{page.title?.trim() || page.slug}</p><p className="mt-1 truncate font-mono text-xs text-ink-soft">/{page.slug}</p></div>
                <Link to={`/app/pages/${encodeURIComponent(page.id)}#page-address`} className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] underline underline-offset-4">Manage address</Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="future-settings-heading" className="mt-10">
        <div className="border-b border-rule pb-3">
          <p className="eyebrow">Not connected</p><h2 id="future-settings-heading" className="mt-1 font-display text-2xl">More ways to grow</h2>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <DeferredCard title="Custom domain" description="Domain connection, DNS verification, and TLS are planned for Release 2. Your OneLink page address remains the only active address." />
          <DeferredCard title="Contact form & submissions" description="Forms and submission management need the Release 2 contact-collection API. No visitor messages are currently captured." />
          <DeferredCard title="Team access" description="Invitations and page roles are planned for Release 2. Page changes are currently owner-only." />
          <article className="border border-rule bg-white/80 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-display text-xl font-medium">Sharing & QR</h2><span className="stamp">Available now</span></div>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">Copy a public address, use native share where supported, and create a QR code from a published page.</p>
            {pages?.some((page) => page.status === 'published') ? (
              <ul className="mt-4 space-y-2">
                {pages.filter((page) => page.status === 'published').map((page) => <li key={page.id}><Link to={`/app/pages/${encodeURIComponent(page.id)}`} className="text-sm underline underline-offset-4">{page.title?.trim() || page.slug}</Link></li>)}
              </ul>
            ) : <p className="mt-4 text-xs text-ink-faint">Publish a page to enable sharing and QR tools.</p>}
          </article>
        </div>
      </section>

      <p className="mt-8 text-sm text-ink-soft">Your profile name, photo, password, and social profiles are available together on the <Link to="/app#profile-editor" className="underline underline-offset-4">Dashboard</Link>.</p>
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
