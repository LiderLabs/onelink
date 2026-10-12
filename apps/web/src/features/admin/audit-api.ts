import { request, requestList } from '../../lib/api'

export interface AdminAuditEntry {
  id: string
  action: string
  actor_label: string | null
  actor_user_id: string | null
  actor_role: string | null
  impersonated_by: string | null
  target_type: string | null
  target_id: string | null
  target_label: string | null
  status: 'success' | 'failure' | 'denied'
  created_at: number
  before: unknown
  after: unknown
  metadata: unknown
  request_id: string
  ip: string | null
  user_agent: string | null
}

export interface AuditFilters {
  q?: string
  action?: string
  status?: string
  from?: number
  to?: number
}

export function readAuditLogs(filters: AuditFilters, page = 1, limit = 25) {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) })
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') query.set(key, String(value))
  }
  return requestList<AdminAuditEntry>(`/admin/audit-logs?${query}`)
}

export function readAuditActions() {
  return request<{ actions: string[] }>('/admin/audit-logs/actions')
}

export function readAuditEntry(id: string) {
  return request<AdminAuditEntry>(`/admin/audit-logs/${encodeURIComponent(id)}`)
}

export async function exportAuditRecords(filters: AuditFilters, cap: number): Promise<AdminAuditEntry[]> {
  const frozen = { ...filters, to: Math.min(filters.to ?? Infinity, Date.now()) }
  const records = new Map<string, AdminAuditEntry>()
  let total: number | null = null
  let pages = 1
  let previous: AdminAuditEntry | undefined
  for (let page = 1; page <= pages; page++) {
    const result = await readAuditLogs(frozen, page, 100)
    if (total === null) {
      total = result.meta.total
      if (total > cap) throw new Error(`${total.toLocaleString()} matching records exceed the ${cap.toLocaleString()} row export limit. Narrow your filters and try again.`)
      pages = Math.ceil(total / 100)
    }
    const expected = Math.min(100, Math.max(0, total - (page - 1) * 100))
    if (result.meta.total !== total || result.meta.page !== page || result.meta.limit !== 100 || result.items.length !== expected) {
      throw new Error('The audit log changed during export. No file was downloaded. Try again with a narrower date range.')
    }
    for (const entry of result.items) {
      if (records.has(entry.id) || (previous && (entry.created_at > previous.created_at ||
          (entry.created_at === previous.created_at && entry.id > previous.id)))) {
        throw new Error('The audit log changed during export. No file was downloaded. Try again with a narrower date range.')
      }
      records.set(entry.id, entry)
      previous = entry
    }
  }
  if (records.size !== total) throw new Error('The audit log changed during export. No file was downloaded. Try again.')
  return [...records.values()]
}

const CSV_COLUMNS: Array<keyof AdminAuditEntry> = [
  'id', 'created_at', 'action', 'status', 'actor_label', 'actor_user_id', 'actor_role',
  'target_type', 'target_id', 'target_label', 'request_id', 'ip', 'user_agent', 'impersonated_by',
  'before', 'after', 'metadata',
]

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  // Quoting alone does not stop a spreadsheet from evaluating a formula.
  if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export function auditCsv(records: AdminAuditEntry[]): string {
  return '\uFEFF' + [CSV_COLUMNS.map(csvCell).join(','), ...records.map(entry =>
    CSV_COLUMNS.map(key => csvCell(key === 'created_at' ? new Date(entry.created_at).toISOString() : entry[key])).join(','),
  )].join('\r\n') + '\r\n'
}
