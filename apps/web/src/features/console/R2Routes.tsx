import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../../lib/session'

// The console's Release 2 surfaces. Analytics and Settings used to live in this
// file as honest unavailable-state screens; both are now tabs on the merged
// editor (`/app/editor/analytics`, `/app/editor/settings`), and `/app/analytics`
// plus `/app/settings` forward to them. Only the submissions inbox is still
// unbuilt, and it states that plainly instead of fabricating records.
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
        <Link to="/app/editor/settings" className="mt-5 inline-block font-mono text-[0.6875rem] uppercase tracking-[0.12em] underline underline-offset-4">View feature availability</Link>
      </div>
    </section>
  )
}
