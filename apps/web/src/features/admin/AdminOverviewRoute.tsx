import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle, ClockCounterClockwise, Flag, Plus, Users } from '@phosphor-icons/react'
import { errorMessageFor, requestList } from '../../lib/api'
import type { ListResponse } from '../../lib/api'
import type { PublicUser } from '../../lib/types'
import { useSession } from '../../lib/session'
import { AdminBadge, AdminHeading, AdminLoading, AdminNotice } from './AdminUI'
import { CreateUserDialog } from './AdminUserDialogs'
import type { ReportRow } from './moderation-api'
import type { AdminAuditEntry } from './audit-api'

interface OverviewData { users?: ListResponse<PublicUser>; active?: ListResponse<PublicUser>; open?: ListResponse<ReportRow>; reviewing?: ListResponse<ReportRow>; audit?: ListResponse<AdminAuditEntry> }
export function AdminOverviewRoute() {
  const session = useSession()
  const [data, setData] = useState<OverviewData | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [retry, setRetry] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const permissions = session.capabilities.join('|')
  useEffect(() => {
    let current = true
    setData(null); setErrors([])
    const reads: Array<{ key: keyof OverviewData; label: string; load: () => Promise<unknown> }> = []
    if (session.can('users.read')) {
      reads.push({ key: 'users', label: 'Users', load: () => requestList<PublicUser>('/admin/users?sort=newest&page=1&limit=5') })
      reads.push({ key: 'active', label: 'Active accounts', load: () => requestList<PublicUser>('/admin/users?status=active&page=1&limit=1') })
    }
    if (session.can('reports.read')) {
      reads.push({ key: 'open', label: 'Open reports', load: () => requestList<ReportRow>('/admin/reports?status=open&page=1&limit=3') })
      reads.push({ key: 'reviewing', label: 'Reports under review', load: () => requestList<ReportRow>('/admin/reports?status=reviewing&page=1&limit=3') })
    }
    if (session.can('audit.read')) reads.push({ key: 'audit', label: 'Admin activity', load: () => requestList<AdminAuditEntry>('/admin/audit-logs?page=1&limit=4') })
    void Promise.allSettled(reads.map(item => item.load())).then(results => {
      if (!current) return
      const next: OverviewData = {}, failures: string[] = []
      results.forEach((result, index) => {
        const read = reads[index]
        if (!read) return
        if (result.status === 'fulfilled') Object.assign(next, { [read.key]: result.value })
        else failures.push(`${read.label}: ${errorMessageFor(result.reason)}`)
      })
      setData(next); setErrors(failures)
    })
    return () => { current = false }
  }, [permissions, retry])
  const reports = [...(data?.open?.items ?? []), ...(data?.reviewing?.items ?? [])].sort((a, b) => b.created_at - a.created_at).slice(0, 4)
  const pending = data?.open && data.reviewing ? data.open.meta.total + data.reviewing.meta.total : undefined
  const metrics = [
    { label: 'Total users', value: data?.users?.meta.total, note: 'Current accounts', icon: Users, enabled: session.can('users.read') },
    { label: 'Active accounts', value: data?.active?.meta.total, note: 'Accounts in good standing', icon: CheckCircle, enabled: session.can('users.read') },
    { label: 'Pending reports', value: pending, note: 'Open or under review', icon: Flag, enabled: session.can('reports.read') },
    { label: 'Admin actions', value: data?.audit?.meta.total, note: 'Recorded audit events', icon: ClockCounterClockwise, enabled: session.can('audit.read') },
  ].filter(item => item.enabled)
  return <>
    <AdminHeading title="Admin Overview" eyebrow="Platform insights" description="Manage the OneLink platform from one secure workspace.">{session.can('users.create') && <button type="button" className="admin-button admin-button-primary" onClick={() => setCreateOpen(true)}><Plus size={17} />Create user</button>}</AdminHeading>
    {!data ? <AdminLoading label="Loading platform overview" /> : <>
      {errors.length > 0 && <div className="admin-stack" style={{ marginBottom: 18 }}><AdminNotice tone="error">{errors.join(' ')}<div className="admin-actions" style={{ marginTop: 10 }}><button type="button" className="admin-button" onClick={() => setRetry(value => value + 1)}>Retry overview</button></div></AdminNotice></div>}
      <section className="admin-metrics" aria-label="Platform totals">{metrics.map(({ label, value, note, icon: Icon }) => <div className="admin-card" key={label}><div className="admin-metric-top"><span>{label}</span><Icon size={20} aria-hidden="true" /></div><div className="admin-metric-value">{value === undefined ? '—' : value.toLocaleString()}</div><p className="admin-help">{value === undefined ? 'Could not load this total' : note}</p></div>)}</section>
      <div className="admin-overview-grid">
        {session.can('users.read') && <section className="admin-card"><div className="admin-section-title"><h2>Account health</h2><Link to="/admin/users">Manage users<ArrowRight size={13} /></Link></div><p className="admin-help">A snapshot of current accounts.</p>{data.users && data.active ? <div className="admin-health">{[
          { label: 'Active accounts', count: data.active.meta.total },
          { label: 'Other account statuses', count: Math.max(0, data.users.meta.total - data.active.meta.total) },
        ].map(item => <div className="admin-health-row" key={item.label}><div><span>{item.label}</span><strong>{item.count.toLocaleString()}</strong></div><div className="admin-health-track"><span style={{ width: `${data.users!.meta.total ? Math.min(100, item.count / data.users!.meta.total * 100) : 0}%` }} /></div></div>)}</div> : <p className="admin-help">Account totals are unavailable.</p>}</section>}
        {session.can('reports.read') && <section className="admin-card"><div className="admin-section-title"><h2>Moderation queue</h2><Link to="/admin/reports">Review reports<ArrowRight size={13} /></Link></div><div className="admin-row-list">{reports.map(report => <Link className="admin-summary-row" to={`/admin/reports?report=${encodeURIComponent(report.id)}`} key={report.id}><Flag size={19} /><div><strong>{report.category.replace(/_/g, ' ')}</strong><small>Reported {report.target_type} · {new Date(report.created_at).toLocaleDateString()}</small></div><AdminBadge value={report.status} /></Link>)}</div>{!reports.length && <p className="admin-help">{data.open && data.reviewing ? 'No reports awaiting review.' : 'The moderation queue could not load.'}</p>}</section>}
        {session.can('users.read') && <section className="admin-card"><div className="admin-section-title"><h2>Recent users</h2><Link to="/admin/users">All users<ArrowRight size={13} /></Link></div><div className="admin-row-list">{data.users?.items.map(user => <Link className="admin-summary-row" to={`/admin/users?user=${encodeURIComponent(user.id)}`} key={user.id}><Users size={19} /><div><strong>{user.displayName}</strong><small>{user.email}</small></div><AdminBadge value={user.status} /></Link>)}</div>{!data.users?.items.length && <p className="admin-help">{data.users ? 'No accounts to show.' : 'Recent users could not load.'}</p>}</section>}
        {session.can('audit.read') && <section className="admin-card"><div className="admin-section-title"><h2>Recent admin activity</h2><Link to="/admin/audit">Audit log<ArrowRight size={13} /></Link></div><div className="admin-row-list">{data.audit?.items.map(entry => <Link className="admin-summary-row" to={`/admin/audit?entry=${encodeURIComponent(entry.id)}`} key={entry.id}><ClockCounterClockwise size={18} /><div><strong>{entry.action}</strong><small>{entry.actor_label ?? 'System'} · {new Date(entry.created_at).toLocaleString()}</small></div><AdminBadge value={entry.status} /></Link>)}</div>{!data.audit?.items.length && <p className="admin-help">{data.audit ? 'No recorded admin activity yet.' : 'Recent admin activity could not load.'}</p>}</section>}
      </div>
    </>}
    <CreateUserDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); setRetry(value => value + 1) }} />
  </>
}
