import { useEffect, useRef, useState } from 'react'
import { errorMessageFor } from '../../lib/api'
import { useResource } from '../../lib/use-resource'
import { useSession } from '../../lib/session'
import { AdminBadge, AdminDialog, AdminForbidden, AdminHeading, AdminLoading, AdminNotice, AdminPagination } from './AdminUI'
import { APPEAL_STATUSES, canModerateTarget, moderationApi, moderationDate } from './moderation-api'
import type { AppealDecision, AppealDetail } from './moderation-api'
import './admin-moderation.css'

const labels: Record<AppealDecision, string> = { uphold: 'Uphold sanction', overturn: 'Overturn sanction', reduce: 'Reduce suspension' }
const HOUR = 60 * 60 * 1000

export function AdminAppealsRoute() {
  const { can } = useSession()
  const [status, setStatus] = useState('pending')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [pending, setPending] = useState(false)
  if (!can('appeals.read')) return <AdminForbidden />
  return <div className="admin-stack admin-moderation">
    <AdminHeading title="Appeals" eyebrow="Account review" description="Review the original sanction and the account holder’s response before deciding." />
    {!can('appeals.decide') && <AdminNotice>You have read-only access to appeals.</AdminNotice>}
    <div className="admin-toolbar"><label className="admin-field">Appeal status<select value={status} disabled={pending} onChange={event => { setStatus(event.target.value); setPage(1) }}><option value="">All statuses</option>{APPEAL_STATUSES.map(value => <option key={value} value={value}>{value}</option>)}</select></label><button type="button" className="admin-button" disabled={pending} onClick={() => setRevision(value => value + 1)}>Refresh queue</button></div>
    <div className="admin-split admin-moderation-split">
      <AppealQueue key={`${page}:${status}:${revision}`} page={page} status={status} selected={selected} pending={pending} onSelect={setSelected} onPage={setPage} />
      {selected ? <AppealReview key={selected} id={selected} onPending={setPending} onChange={() => setRevision(value => value + 1)} onClose={() => setSelected(null)} />
        : <section className="admin-card admin-empty"><h2>Select an appeal</h2><p>Inspect the request, original reason, and current sanction state.</p></section>}
    </div>
  </div>
}

function AppealQueue({ page, status, selected, pending, onSelect, onPage }: { page: number; status: string; selected: string | null; pending: boolean; onSelect: (id: string) => void; onPage: (page: number) => void }) {
  const resource = useResource(() => moderationApi.appeals(page, status))
  return <section className="admin-card admin-stack" aria-label="Appeal queue">
    <div className="admin-moderation-section-heading"><h2>Appeal queue</h2>{resource.data && <span className="admin-help">{resource.data.meta.total} appeals</span>}</div>
    {resource.loading ? <AdminLoading label="Loading appeals" /> : resource.error ? <AdminNotice tone="error">{errorMessageFor(resource.error)} <button type="button" className="admin-button" onClick={resource.reload}>Retry queue</button></AdminNotice>
      : resource.data && <>
        {resource.data.items.length === 0 ? <div className="admin-empty">No appeals match these filters.</div> : <div className="admin-table-scroll"><table className="admin-moderation-table"><thead><tr><th>Account / sanction</th><th>Status</th><th>Review</th></tr></thead><tbody>{resource.data.items.map(appeal => <tr key={appeal.id} data-selected={selected === appeal.id}><td><strong>@{appeal.username}</strong><span>{appeal.sanction_type} · attempt {appeal.attempt}</span><small>{moderationDate(appeal.created_at)}</small></td><td><AdminBadge value={appeal.status} /></td><td><button type="button" className="admin-button" disabled={pending} aria-pressed={selected === appeal.id} onClick={() => onSelect(appeal.id)}>Review appeal</button></td></tr>)}</tbody></table></div>}
        <AdminPagination meta={resource.data.meta} onPage={onPage} disabled={pending} />
      </>}
  </section>
}

function AppealReview({ id, onPending, onChange, onClose }: { id: string; onPending: (pending: boolean) => void; onChange: () => void; onClose: () => void }) {
  const resource = useResource(() => moderationApi.appeal(id))
  if (resource.loading) return <section className="admin-card"><AdminLoading label="Loading appeal detail" /></section>
  if (resource.error) return <section className="admin-card"><AdminNotice tone="error">{errorMessageFor(resource.error)} <button type="button" className="admin-button" onClick={resource.reload}>Retry detail</button></AdminNotice></section>
  return resource.data ? <AppealDetailView initial={resource.data} onPending={onPending} onChange={onChange} onClose={onClose} /> : null
}

function AppealDetailView({ initial, onPending, onChange, onClose }: { initial: AppealDetail; onPending: (pending: boolean) => void; onChange: () => void; onClose: () => void }) {
  const { can, user } = useSession()
  const [appeal, setAppeal] = useState(initial)
  const target = useResource(() => moderationApi.user(appeal.user_id), { enabled: can('appeals.decide') && can('users.read') })
  const rankAllowed = canModerateTarget(user, target.data?.user ?? null)
  const [decision, setDecision] = useState<AppealDecision | null>(null)
  const [notes, setNotes] = useState('')
  const [duration, setDuration] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const busy = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; onPending(false) } }, [onPending])
  const active = appeal.sanction_status === 'active' && (appeal.expires_at === null || appeal.expires_at > Date.now())
  const maximumReducedHours = appeal.duration_hours !== null && appeal.expires_at !== null
    ? Math.min(appeal.duration_hours - 1, Math.ceil((appeal.expires_at - Date.now()) / HOUR) - 1) : 0
  const canReduce = active && appeal.sanction_type === 'suspend' && maximumReducedHours >= 1
  const allowed = appeal.status === 'pending' && can('appeals.decide') && rankAllowed
  const begin = (value: AppealDecision) => { setDecision(value); setNotes(''); setDuration(''); setError(null) }
  const submit = async () => {
    if (!decision || busy.current || !allowed) return
    const reason = notes.trim()
    if (reason.length < 3 || reason.length > 2000) { setError('Enter decision notes between 3 and 2000 characters.'); return }
    const hours = Number(duration)
    if (decision === 'reduce' && (!canReduce || !Number.isInteger(hours) || hours < 1 || hours > 24 * 365 * 10 || appeal.duration_hours === null || hours >= appeal.duration_hours || appeal.expires_at === null || Date.now() + hours * HOUR >= appeal.expires_at)) {
      setError('Use a whole number of hours shorter than the original duration and the time remaining.'); return
    }
    if (decision === 'overturn' && !active) { setError('Only an active sanction can be overturned.'); return }
    busy.current = true; setPending(true); onPending(true); setError(null)
    try {
      const updated = await moderationApi.decide(appeal.id, decision, reason, decision === 'reduce' ? hours : undefined)
      if (mounted.current) { setAppeal(updated); setDecision(null); setNotice(`Appeal ${updated.status}. Decision recorded: ${decision}.`) }
      onChange()
    } catch (failure) { if (mounted.current) setError(errorMessageFor(failure)) }
    finally { busy.current = false; if (mounted.current) { setPending(false); onPending(false) } }
  }
  return <section className="admin-card admin-stack" aria-label="Appeal detail">
    <div className="admin-moderation-section-heading"><div><p className="admin-help">Appeal attempt {appeal.attempt}</p><h2>@{appeal.username}</h2></div><button type="button" className="admin-button" disabled={pending} onClick={onClose}>Close detail</button></div>
    <div className="admin-actions"><AdminBadge value={appeal.status} /><AdminBadge value={appeal.sanction_type} /><AdminBadge value={appeal.sanction_status} /></div>
    {notice && <AdminNotice tone="success">{notice}</AdminNotice>}
    <dl className="admin-detail-list"><div><dt>Account</dt><dd>{appeal.email}</dd></div><div><dt>Submitted</dt><dd>{moderationDate(appeal.created_at)}</dd></div><div><dt>Original duration</dt><dd>{appeal.duration_hours === null ? 'No timed duration' : `${appeal.duration_hours} hours`}</dd></div><div><dt>Expires</dt><dd>{appeal.expires_at === null ? 'No expiry' : moderationDate(appeal.expires_at)}</dd></div></dl>
    <div><h3>Sanction reason</h3><p className="admin-moderation-prose">{appeal.sanction_reason}</p></div>
    <div><h3>Account holder’s appeal</h3><p className="admin-moderation-prose">{appeal.message}</p></div>
    {appeal.decision && <div className="admin-moderation-action-panel"><h3>Recorded decision: {appeal.decision}</h3><p className="admin-moderation-prose">{appeal.decision_notes ?? 'No decision notes available.'}</p><p className="admin-help">{appeal.reviewed_by_label ?? 'Staff'} · {moderationDate(appeal.reviewed_at)}</p></div>}
    {appeal.status === 'pending' && can('appeals.decide') && <>
      {target.loading && <AdminLoading label="Checking target account permissions" />}
      {target.error && <AdminNotice tone="error">Decisions are unavailable until account permissions can be checked. {errorMessageFor(target.error)} <button type="button" className="admin-button" onClick={target.reload}>Retry account check</button></AdminNotice>}
      {!can('users.read') && <AdminNotice>Decisions are unavailable because you cannot inspect the target account’s rank.</AdminNotice>}
      {target.data && !rankAllowed && <AdminNotice>You cannot decide an appeal for your own account or an account at or above your rank.</AdminNotice>}
      {allowed && <div className="admin-moderation-action-panel"><h3>Decide appeal</h3><p className="admin-help">The server validates current rank and sanction state when you confirm.</p><div className="admin-actions"><button type="button" className="admin-button" disabled={pending} onClick={() => begin('uphold')}>Uphold sanction</button>{active && <button type="button" className="admin-button admin-button-primary" disabled={pending} onClick={() => begin('overturn')}>Overturn sanction</button>}{canReduce && <button type="button" className="admin-button" disabled={pending} onClick={() => begin('reduce')}>Reduce suspension</button>}</div>{!canReduce && <p className="admin-help">Reduction is available for an active timed suspension with at least one full hour to reduce.</p>}</div>}
    </>}
    <AdminDialog open={decision !== null} title={decision ? labels[decision] : 'Appeal decision'} pending={pending} onClose={() => { if (!busy.current) { setDecision(null); setError(null) } }} description={decision === 'overturn' ? 'Overturn this sanction. The server determines whether the account can be reactivated after checking its other sanctions.' : decision === 'reduce' ? 'Set a shorter suspension from the time of this decision. It must expire before the current suspension.' : 'Keep the sanction and reject this appeal. Record the reason for the account holder.'}>
      <div className="admin-stack">{error && <AdminNotice tone="error">{error}</AdminNotice>}<label className="admin-field">Decision notes<textarea value={notes} onChange={event => setNotes(event.target.value)} rows={4} maxLength={2000} disabled={pending} /></label><p className="admin-help">Between 3 and 2000 characters.</p>{decision === 'reduce' && <label className="admin-field">Reduced duration in hours<input type="number" min={1} max={maximumReducedHours} step={1} value={duration} onChange={event => setDuration(event.target.value)} disabled={pending} /><span className="admin-help">1–{maximumReducedHours} whole hours; must be shorter than the original and remaining duration.</span></label>}<div className="admin-actions"><button type="button" className="admin-button" disabled={pending} onClick={() => { setDecision(null); setError(null) }}>Cancel</button><button type="button" className="admin-button admin-button-primary" disabled={pending} onClick={() => void submit()}>{pending ? 'Working…' : decision ? labels[decision] : 'Confirm'}</button></div></div>
    </AdminDialog>
  </section>
}
