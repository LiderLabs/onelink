import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { errorMessageFor } from '../../lib/api'
import type { ListResponse } from '../../lib/api'
import { useSession } from '../../lib/session'
import { AdminBadge, AdminDialog, AdminForbidden, AdminHeading, AdminLoading, AdminNotice, AdminPagination } from './AdminUI'
import { auditCsv, exportAuditRecords, readAuditActions, readAuditEntry, readAuditLogs } from './audit-api'
import type { AdminAuditEntry, AuditFilters } from './audit-api'
import { readAdminSettings } from './settings-api'
import './admin-settings-audit.css'

interface FilterDraft { q: string; action: string; status: string; from: string; to: string }
const EMPTY_FILTERS: FilterDraft = { q: '', action: '', status: '', from: '', to: '' }

function humanError(error: unknown): string {
  return error instanceof Error && error.name !== 'ApiError' ? error.message : errorMessageFor(error)
}

function time(value: number): string { return new Date(value).toLocaleString() }

export function AdminAuditRoute() {
  const [params, setParams] = useSearchParams()
  const { can } = useSession()
  const canRead = can('audit.read')
  const canReadSettings = can('settings.read')
  const [actions, setActions] = useState<string[]>([])
  const [actionError, setActionError] = useState<string | null>(null)
  const [draft, setDraft] = useState<FilterDraft>(() => ({ ...EMPTY_FILTERS, q: (params.get('q') ?? '').slice(0, 40) }))
  const [filters, setFilters] = useState<AuditFilters>(() => ({ q: (params.get('q') ?? '').slice(0, 40) }))
  const [filterError, setFilterError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<ListResponse<AdminAuditEntry> | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const selectedId = params.get('entry')
  const setSelectedId = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('entry', id)
    else next.delete('entry')
    setParams(next, { replace: true })
  }
  const [detail, setDetail] = useState<AdminAuditEntry | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailReload, setDetailReload] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportSuccess, setExportSuccess] = useState<string | null>(null)
  const [exportCap, setExportCap] = useState<number | null>(canReadSettings ? null : 50_000)
  const [capError, setCapError] = useState<string | null>(null)
  const [configReload, setConfigReload] = useState(0)

  useEffect(() => {
    if (!canRead) return
    let cancelled = false
    setActionError(null)
    readAuditActions().then(data => { if (!cancelled) setActions(data.actions) }).catch(error => {
      if (!cancelled) setActionError(errorMessageFor(error))
    })
    if (canReadSettings) {
      setExportCap(null)
      setCapError(null)
      readAdminSettings().then(settings => {
        if (cancelled) return
        const value = settings.find(setting => setting.key === 'audit.export_max_rows')?.value
        if (value === undefined) setExportCap(50_000)
        else if (typeof value === 'number' && Number.isFinite(value) && value > 0) setExportCap(Math.floor(value))
        else setCapError('The audit export limit is invalid. Ask the owner to review platform settings.')
      }).catch(error => { if (!cancelled) setCapError(`Could not read the audit export limit. ${errorMessageFor(error)}`) })
    }
    return () => { cancelled = true }
  }, [canRead, canReadSettings, configReload])

  useEffect(() => {
    if (!canRead) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    readAuditLogs(filters, page).then(data => {
      if (!cancelled) { setResult(data); setLoading(false) }
    }).catch(error => {
      if (!cancelled) { setLoadError(errorMessageFor(error)); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [canRead, filters, page, reload])

  useEffect(() => {
    if (!selectedId || !canRead) return
    let cancelled = false
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    readAuditEntry(selectedId).then(entry => {
      if (!cancelled) { setDetail(entry); setDetailLoading(false) }
    }).catch(error => {
      if (!cancelled) { setDetailError(errorMessageFor(error)); setDetailLoading(false) }
    })
    return () => { cancelled = true }
  }, [canRead, selectedId, detailReload])

  const applyFilters = () => {
    const from = draft.from ? new Date(`${draft.from}T00:00:00`).getTime() : undefined
    const to = draft.to ? new Date(`${draft.to}T23:59:59.999`).getTime() : undefined
    if ((from !== undefined && !Number.isFinite(from)) || (to !== undefined && !Number.isFinite(to)) ||
        (from !== undefined && to !== undefined && from > to)) {
      setFilterError('Choose a valid date range with the start on or before the end.')
      return
    }
    setFilterError(null)
    setExportError(null)
    setExportSuccess(null)
    setPage(1)
    setFilters({ q: draft.q.trim().slice(0, 40), action: draft.action, status: draft.status, from, to })
  }

  const exportCsv = async () => {
    if (exporting || exportCap === null || !canRead) return
    setExporting(true)
    setExportError(null)
    setExportSuccess(null)
    try {
      const records = await exportAuditRecords(filters, exportCap)
      const url = URL.createObjectURL(new Blob([auditCsv(records)], { type: 'text/csv;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `onelink-audit-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setExportSuccess(`Exported ${records.length.toLocaleString()} matching records.`)
    } catch (error) { setExportError(`${humanError(error)} No partial file was downloaded.`) }
    finally { setExporting(false) }
  }

  if (!canRead) return <AdminForbidden />

  return <div className="admin-stack admin-audit">
    <AdminHeading title="Audit log" description="A chronological record of platform changes and staff activity." eyebrow="Accountability">
      <button className="admin-button admin-button-primary" onClick={() => { void exportCsv() }} disabled={exporting || exportCap === null || loading || Boolean(loadError)}>{exporting ? 'Preparing export…' : 'Export CSV'}</button>
    </AdminHeading>
    <form className="admin-card admin-audit-filters" onSubmit={event => { event.preventDefault(); applyFilters() }}>
      <label className="admin-audit-filter admin-audit-search">Search audit log<input className="admin-field" placeholder="Search action, actor, or target" maxLength={40} value={draft.q} onChange={event => setDraft(value => ({ ...value, q: event.target.value }))} disabled={exporting} /></label>
      <label className="admin-audit-filter">Action<select className="admin-field" aria-label="Action" value={draft.action} onChange={event => setDraft(value => ({ ...value, action: event.target.value }))} disabled={exporting}><option value="">All actions</option>{actions.map(action => <option value={action} key={action}>{action}</option>)}</select></label>
      <label className="admin-audit-filter">Status<select className="admin-field" aria-label="Status" value={draft.status} onChange={event => setDraft(value => ({ ...value, status: event.target.value }))} disabled={exporting}><option value="">All statuses</option><option value="success">Success</option><option value="failure">Failure</option><option value="denied">Denied</option></select></label>
      <label className="admin-audit-filter">From date<input className="admin-field" type="date" value={draft.from} onChange={event => setDraft(value => ({ ...value, from: event.target.value }))} disabled={exporting} /></label>
      <label className="admin-audit-filter">To date<input className="admin-field" type="date" value={draft.to} onChange={event => setDraft(value => ({ ...value, to: event.target.value }))} disabled={exporting} /></label>
      <div className="admin-actions"><button className="admin-button admin-button-primary" type="submit" disabled={exporting}>Apply filters</button><button className="admin-button" type="button" disabled={exporting} onClick={() => { setDraft(EMPTY_FILTERS); setFilters({}); setPage(1); setFilterError(null); setExportError(null); setExportSuccess(null) }}>Clear</button></div>
    </form>
    {filterError && <AdminNotice tone="error">{filterError}</AdminNotice>}
    {actionError && <AdminNotice tone="warning"><p>Action filters could not be loaded. {actionError}</p><button className="admin-button" onClick={() => setConfigReload(value => value + 1)}>Retry action filters</button></AdminNotice>}
    {capError && <AdminNotice tone="error"><p>{capError}</p><button className="admin-button" onClick={() => setConfigReload(value => value + 1)}>Retry export configuration</button></AdminNotice>}
    <div className="admin-audit-summary"><p>{result ? `${result.meta.total.toLocaleString()} records` : 'Audit activity'}<span> · Newest first</span></p><p className="admin-help">Export includes all applied filters{exportCap !== null ? ` · Limit ${exportCap.toLocaleString()} rows` : ''}</p></div>
    {exporting && <AdminNotice>Fetching every matching page. The export uses a fixed end time to exclude new activity.</AdminNotice>}
    {exportError && <AdminNotice tone="error">{exportError}</AdminNotice>}
    {exportSuccess && <AdminNotice tone="success">{exportSuccess}</AdminNotice>}
    {loadError && <AdminNotice tone="error"><p>{loadError}</p><button className="admin-button" onClick={() => setReload(value => value + 1)}>Retry audit log</button></AdminNotice>}
    {loading && <AdminLoading label="Loading audit entries" />}
    {!loading && !loadError && result && <section className="admin-card admin-audit-table-card">
      {result.items.length === 0 ? <div className="admin-empty">No audit entries match these filters.</div> : <div className="admin-table-scroll"><table className="admin-audit-table"><thead><tr><th scope="col">Time</th><th scope="col">Action</th><th scope="col">Actor</th><th scope="col">Target</th><th scope="col">Status</th><th scope="col"><span className="admin-audit-sr-only">Details</span></th></tr></thead><tbody>{result.items.map(entry => <tr key={entry.id}>
        <td><time dateTime={new Date(entry.created_at).toISOString()}>{time(entry.created_at)}</time></td><td><code>{entry.action}</code></td><td><strong>{entry.actor_label ?? 'System'}</strong><small>{entry.actor_role ?? 'System'}</small></td><td>{entry.target_label ?? entry.target_id ?? '—'}<small>{entry.target_type ?? '—'}</small></td><td><AdminBadge value={entry.status} /></td><td><button className="admin-button" aria-label={`Inspect ${entry.id}`} onClick={() => setSelectedId(entry.id)}>Inspect</button></td>
      </tr>)}</tbody></table></div>}
      <AdminPagination meta={result.meta} onPage={setPage} disabled={loading || exporting} />
    </section>}
    <AdminDialog open={selectedId !== null} title="Audit entry" description="Recorded context for this event." onClose={() => setSelectedId(null)}>
      {detailLoading && <AdminLoading label="Loading audit entry" />}
      {detailError && <AdminNotice tone="error"><p>{detailError}</p><button className="admin-button" onClick={() => setDetailReload(value => value + 1)}>Retry entry</button></AdminNotice>}
      {detail && <div className="admin-stack admin-audit-detail"><dl className="admin-detail-list">
        <div><dt>Action</dt><dd>{detail.action}</dd></div><div><dt>Status</dt><dd><AdminBadge value={detail.status} /></dd></div><div><dt>Time</dt><dd>{time(detail.created_at)}</dd></div><div><dt>Entry ID</dt><dd>{detail.id}</dd></div><div><dt>Actor</dt><dd>{detail.actor_label ?? 'System'} · {detail.actor_role ?? 'System'}</dd></div><div><dt>Actor ID</dt><dd>{detail.actor_user_id ?? '—'}</dd></div><div><dt>Target</dt><dd>{detail.target_label ?? detail.target_id ?? '—'} · {detail.target_type ?? '—'}</dd></div><div><dt>Target ID</dt><dd>{detail.target_id ?? '—'}</dd></div><div><dt>Request ID</dt><dd>{detail.request_id}</dd></div><div><dt>IP address</dt><dd>{detail.ip ?? '—'}</dd></div><div><dt>User agent</dt><dd>{detail.user_agent ?? '—'}</dd></div>{detail.impersonated_by && <div><dt>Impersonated by</dt><dd>{detail.impersonated_by}</dd></div>}
      </dl><div className="admin-audit-json-grid">{(['before', 'after', 'metadata'] as const).map(key => <section key={key}><h3>{key === 'before' ? 'Before' : key === 'after' ? 'After' : 'Metadata'}</h3><pre>{JSON.stringify(detail[key], null, 2) ?? 'null'}</pre></section>)}</div></div>}
      <div className="admin-actions"><button className="admin-button" onClick={() => setSelectedId(null)}>Close entry</button></div>
    </AdminDialog>
  </div>
}
