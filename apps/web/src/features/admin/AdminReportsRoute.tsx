import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { errorMessageFor } from '../../lib/api'
import { useResource } from '../../lib/use-resource'
import { useSession } from '../../lib/session'
import { AdminBadge, AdminDialog, AdminForbidden, AdminHeading, AdminLoading, AdminNotice, AdminPagination } from './AdminUI'
import { canModerateTarget, moderationApi, moderationDate, reportEvidence, REPORT_CATEGORIES, REPORT_STATUSES } from './moderation-api'
import type { ReportDetail, ReportRow } from './moderation-api'
import './admin-moderation.css'

type ReportDecision = 'dismiss' | 'resolve' | 'duplicate' | 'remove' | 'warn' | 'ban'
type FollowUp = { outcome: string; notes: string }
// Retain confirmed first steps through selection changes and SPA navigation.
const followUps = new Map<string, FollowUp>()
const labels: Record<ReportDecision, string> = {
  dismiss: 'Dismiss report', resolve: 'Resolve report', duplicate: 'Mark duplicate',
  remove: 'Remove entire page', warn: 'Warn user', ban: 'Ban user',
}
const isOpen = (report: ReportRow) => report.status === 'open' || report.status === 'reviewing'

export function AdminReportsRoute() {
  const { can } = useSession()
  const [searchParams] = useSearchParams()
  const requestedId = searchParams.get('report') ?? searchParams.get('id')
  const [status, setStatus] = useState('open')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(requestedId)
  const [revision, setRevision] = useState(0)
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  useEffect(() => { if (requestedId && !pendingRef.current) setSelected(requestedId) }, [requestedId])
  if (!can('reports.read')) return <AdminForbidden />
  return <div className="admin-stack admin-moderation">
    <AdminHeading title="Reports" description="Review reported content, preserve the evidence, and record each decision." eyebrow="Moderation queue" />
    {!can('reports.resolve') && <AdminNotice>You have read-only access to reports.</AdminNotice>}
    <div className="admin-toolbar">
      <label className="admin-field">Report status<select value={status} disabled={pending} onChange={event => { setStatus(event.target.value); setPage(1) }}>
        <option value="">All statuses</option>{REPORT_STATUSES.map(value => <option key={value} value={value}>{value}</option>)}
      </select></label>
      <label className="admin-field">Report category<select value={category} disabled={pending} onChange={event => { setCategory(event.target.value); setPage(1) }}>
        <option value="">All categories</option>{REPORT_CATEGORIES.map(value => <option key={value} value={value}>{value}</option>)}
      </select></label>
      <button type="button" className="admin-button" disabled={pending} onClick={() => setRevision(value => value + 1)}>Refresh queue</button>
    </div>
    <div className="admin-split admin-moderation-split">
      <ReportQueue key={`${page}:${status}:${category}:${revision}`} page={page} status={status} category={category} pending={pending} selected={selected} onSelect={setSelected} onPage={setPage} />
      {selected ? <ReportReview key={selected} id={selected} onPending={setPending} onChange={() => setRevision(value => value + 1)} onClose={() => setSelected(null)} />
        : <section className="admin-card admin-empty"><h2>Select a report</h2><p>Open a queue item to inspect its stored evidence and action history.</p></section>}
    </div>
  </div>
}

function ReportQueue({ page, status, category, pending, selected, onSelect, onPage }: {
  page: number; status: string; category: string; pending: boolean; selected: string | null
  onSelect: (id: string) => void; onPage: (page: number) => void
}) {
  const resource = useResource(() => moderationApi.reports(page, status, category))
  return <section className="admin-card admin-stack" aria-label="Report queue">
    <div className="admin-moderation-section-heading"><h2>Report queue</h2>{resource.data && <span className="admin-help">{resource.data.meta.total} reports</span>}</div>
    {resource.loading ? <AdminLoading label="Loading reports" /> : resource.error ? <AdminNotice tone="error">{errorMessageFor(resource.error)} <button type="button" className="admin-button" onClick={resource.reload}>Retry queue</button></AdminNotice>
      : resource.data && <>
        {resource.data.items.length === 0 ? <div className="admin-empty">No reports match these filters.</div> : <div className="admin-table-scroll"><table className="admin-moderation-table"><thead><tr><th>Target / category</th><th>Status</th><th>Review</th></tr></thead><tbody>
          {resource.data.items.map(report => <tr key={report.id} data-selected={selected === report.id}>
            <td><strong>{report.category}</strong><span>{report.target_type} · {report.reporter_label ?? 'Anonymous reporter'}</span><small>{moderationDate(report.created_at)}</small></td>
            <td><AdminBadge value={report.status} /></td>
            <td><button type="button" className="admin-button" disabled={pending} aria-pressed={selected === report.id} onClick={() => onSelect(report.id)}>Review report</button></td>
          </tr>)}
        </tbody></table></div>}
        <AdminPagination meta={resource.data.meta} onPage={onPage} disabled={pending} />
      </>}
  </section>
}

function ReportReview({ id, onPending, onChange, onClose }: { id: string; onPending: (pending: boolean) => void; onChange: () => void; onClose: () => void }) {
  const resource = useResource(() => moderationApi.report(id))
  if (resource.loading) return <section className="admin-card"><AdminLoading label="Loading report detail" /></section>
  if (resource.error) return <section className="admin-card"><AdminNotice tone="error">{errorMessageFor(resource.error)} <button type="button" className="admin-button" onClick={resource.reload}>Retry detail</button></AdminNotice></section>
  return resource.data ? <ReportDetailView initial={resource.data} onPending={onPending} onChange={onChange} onClose={onClose} /> : null
}

function ReportDetailView({ initial, onPending, onChange, onClose }: { initial: ReportDetail; onPending: (pending: boolean) => void; onChange: () => void; onClose: () => void }) {
  const { can, user } = useSession()
  const [report, setReport] = useState(initial)
  const evidence = reportEvidence(report)
  const target = useResource(() => moderationApi.reportOwner(evidence.ownerId, evidence.ownerUsername), { enabled: Boolean((evidence.ownerId || evidence.ownerUsername) && can('users.read') && (can('users.sanction') || can('content.moderate'))) })
  const ownerId = target.data?.user?.id ?? null
  const rankAllowed = canModerateTarget(user, target.data?.user ?? null)
  const [action, setAction] = useState<ReportDecision | null>(null)
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [followUp, setFollowUp] = useState<FollowUp | null>(followUps.get(report.id) ?? null)
  const mounted = useRef(true)
  const busy = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; onPending(false) } }, [onPending])
  const lock = (value: boolean) => { busy.current = value; if (mounted.current) { setPending(value); onPending(value) } }
  const updateReport = (value: ReportDetail) => { if (mounted.current) setReport(value); onChange() }
  const begin = (value: ReportDecision) => { setNotes(''); setError(null); setAction(value) }
  const completeResolution = async (fact: FollowUp, checkCurrent = false) => {
    const current = checkCurrent ? await moderationApi.report(report.id) : report
    const updated = isOpen(current) ? await moderationApi.resolve(report.id, 'resolved', fact.notes) : current
    followUps.delete(report.id)
    if (mounted.current) { setFollowUp(null); setNotice(`${fact.outcome} Report ${updated.status}.`); setError(null) }
    updateReport(updated)
  }
  const retryResolution = async () => {
    if (!followUp || busy.current || !can('reports.resolve')) return
    lock(true)
    try { await completeResolution(followUp, true) }
    catch (failure) { if (mounted.current) setError(errorMessageFor(failure)) }
    finally { lock(false) }
  }
  const assign = async () => {
    if (busy.current || !isOpen(report) || !can('reports.assign') || followUp) return
    lock(true); setError(null)
    try { updateReport(await moderationApi.assign(report.id)); if (mounted.current) setNotice('Report assigned to you.') }
    catch (failure) { if (mounted.current) setError(errorMessageFor(failure)) }
    finally { lock(false) }
  }
  const submit = async () => {
    if (!action || busy.current || followUp || !can('reports.resolve') || !isOpen(report)) return
    const reason = notes.trim()
    const maxLength = action === 'warn' || action === 'ban' ? 1000 : 2000
    if (reason.length < 3 || reason.length > maxLength) { setError(`Enter notes between 3 and ${maxLength} characters.`); return }
    if ((action === 'warn' || action === 'ban') && (!can('users.sanction') || !rankAllowed || !ownerId)) return
    if (action === 'remove' && (!can('content.moderate') || !report.page_id || (target.data?.user && !rankAllowed))) return
    lock(true); setError(null); setNotice(null)
    try {
      if (action === 'remove' || action === 'warn' || action === 'ban') {
        if (action === 'remove') await moderationApi.removePage(report.page_id!, reason, report.id)
        else await moderationApi.sanction(ownerId!, action, reason, report.category, report.id)
        const fact = { outcome: action === 'remove' ? 'Page removed.' : action === 'ban' ? 'User banned.' : 'Warning issued.', notes: reason }
        followUps.set(report.id, fact)
        if (mounted.current) { setFollowUp(fact); setAction(null) }
        try { await completeResolution(fact) }
        catch (failure) { if (mounted.current) setError(errorMessageFor(failure)) }
      } else {
        const updated = await moderationApi.resolve(report.id, action === 'dismiss' ? 'dismissed' : action === 'duplicate' ? 'duplicate' : 'resolved', reason)
        updateReport(updated)
        if (mounted.current) { setAction(null); setNotice(`Report ${updated.status}.`) }
      }
    } catch (failure) { if (mounted.current) setError(errorMessageFor(failure)) }
    finally { lock(false) }
  }
  const actionable = isOpen(report) && !followUp
  const canResolve = can('reports.resolve')
  const sanctionAllowed = canResolve && can('users.sanction') && rankAllowed
  const pageAllowed = canResolve && can('content.moderate') && report.page_id && (!target.data?.user || rankAllowed)
  return <section className="admin-card admin-stack" aria-label="Report detail">
    <div className="admin-moderation-section-heading"><div><p className="admin-help">{report.target_type} report</p><h2>{evidence.label}</h2></div><button type="button" className="admin-button" onClick={onClose} disabled={pending}>Close detail</button></div>
    <div className="admin-actions"><AdminBadge value={report.status} /><AdminBadge value={report.category} />{evidence.publicPath && <a className="admin-button" href={evidence.publicPath} target="_blank" rel="noopener noreferrer">Open public page</a>}</div>
    {followUp && <AdminNotice tone={pending ? 'info' : 'warning'}>{followUp.outcome} {pending ? 'Resolving this report…' : 'The report resolution could not be completed. The completed action will not be repeated.'} {canResolve && !pending && <button type="button" className="admin-button" onClick={() => void retryResolution()}>Retry report resolution</button>}</AdminNotice>}
    {notice && <AdminNotice tone="success">{notice}</AdminNotice>}
    {error && !action && <AdminNotice tone="error">{error}</AdminNotice>}
    <dl className="admin-detail-list"><div><dt>Reporter</dt><dd>{report.reporter_label ?? 'Anonymous'}{report.reporter_email && <span>{report.reporter_email}</span>}</dd></div><div><dt>Submitted</dt><dd>{moderationDate(report.created_at)}</dd></div><div><dt>Assigned to</dt><dd>{report.assigned_admin_id === user?.id ? 'You' : report.assigned_admin_id ?? 'Unassigned'}</dd></div><div><dt>Priority</dt><dd>{report.priority}</dd></div></dl>
    <div><h3>Report description</h3><p className="admin-moderation-prose">{report.description || 'No description supplied.'}</p></div>
    <details className="admin-moderation-evidence"><summary>Stored target snapshot</summary><pre>{evidence.snapshot ? JSON.stringify(evidence.snapshot, null, 2) : report.target_snapshot ?? 'No snapshot available.'}</pre></details>
    {actionable && <>
      <div className="admin-actions">
        {can('reports.assign') && <button type="button" className="admin-button" disabled={pending} onClick={() => void assign()}>Assign to me</button>}
        {canResolve && <><button type="button" className="admin-button" disabled={pending} onClick={() => begin('dismiss')}>Dismiss report</button><button type="button" className="admin-button admin-button-primary" disabled={pending} onClick={() => begin('resolve')}>Resolve report</button><button type="button" className="admin-button" disabled={pending} onClick={() => begin('duplicate')}>Mark duplicate</button></>}
      </div>
      {canResolve && <div className="admin-moderation-action-panel">
        <h3>Moderation action</h3>
        <p className="admin-help">Successful actions are followed by report resolution. The server checks current account rank and state.</p>
        {target.loading && <p className="admin-help">Checking target account permissions…</p>}
        {target.error && <p className="admin-help">Account actions unavailable: {errorMessageFor(target.error)} <button type="button" className="admin-button" onClick={target.reload}>Retry account lookup</button></p>}
        {!target.loading && !ownerId && !target.error && can('users.sanction') && <p className="admin-help">Warning and ban are unavailable because the reported owner could not be matched to a current account.</p>}
        {target.data?.user && <p className="admin-help">Account: {target.data.user.displayName} · @{target.data.user.username} · {target.data.user.email}</p>}
        {target.data?.user && !rankAllowed && <p className="admin-help">You cannot moderate your own account or an account at or above your rank.</p>}
        <div className="admin-actions">
          {sanctionAllowed && <><button type="button" className="admin-button" disabled={pending} onClick={() => begin('warn')}>Warn user</button><button type="button" className="admin-button admin-button-danger" disabled={pending} onClick={() => begin('ban')}>Ban user</button></>}
          {pageAllowed && <button type="button" className="admin-button admin-button-danger" disabled={pending || target.loading} onClick={() => begin('remove')}>Remove entire page</button>}
        </div>
      </div>}
    </>}
    {report.target_type === 'link' && <p className="admin-help">Specific-link removal is unavailable. The moderation API can remove the entire page; it has no action to remove one reported link.</p>}
    <div><h3>Action history</h3>{report.actions.length ? <ol className="admin-moderation-history">{report.actions.map(entry => <li key={entry.id}><div><strong>{entry.action.replaceAll('_', ' ')}</strong><span>{entry.admin_label ?? 'Staff'} · {moderationDate(entry.created_at)}</span></div>{entry.notes && <p className="admin-moderation-prose">{entry.notes}</p>}</li>)}</ol> : <p className="admin-help">No actions recorded yet.</p>}</div>
    <AdminDialog open={action !== null} title={action ? labels[action] : 'Report decision'} pending={pending} onClose={() => { if (!busy.current) { setAction(null); setError(null) } }} description={action === 'remove' ? 'This removes the ENTIRE PAGE from public view, including every link on it. It does not remove only the reported link.' : action === 'ban' ? 'This bans the owner account and revokes its sessions, then resolves this report.' : action === 'warn' ? 'Issue a warning to the identified account and resolve this report.' : 'Record your notes and close this report with the selected outcome.'}>
      <div className="admin-stack">{error && <AdminNotice tone="error">{error}</AdminNotice>}{(action === 'warn' || action === 'ban') && target.data?.user && <p className="admin-help">Account: <strong>{target.data.user.displayName}</strong> · @{target.data.user.username} · {target.data.user.email}</p>}<label className="admin-field">{action === 'remove' || action === 'ban' || action === 'warn' ? 'Reason' : 'Notes'}<textarea value={notes} onChange={event => setNotes(event.target.value)} disabled={pending} rows={4} maxLength={action === 'ban' || action === 'warn' ? 1000 : 2000} /></label><p className="admin-help">At least 3 characters. Your notes are recorded with this action.</p><div className="admin-actions"><button type="button" className="admin-button" disabled={pending} onClick={() => { setAction(null); setError(null) }}>Cancel</button><button type="button" className={`admin-button ${action === 'remove' || action === 'ban' ? 'admin-button-danger' : 'admin-button-primary'}`} disabled={pending} onClick={() => void submit()}>{pending ? 'Working…' : action ? labels[action] : 'Confirm'}</button></div></div>
    </AdminDialog>
  </section>
}
