import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Info, ShieldCheck, SpinnerGap, X } from '@phosphor-icons/react'
import type { ListResponse } from '../../lib/api'

export function AdminHeading({ title, description, eyebrow = 'Platform management', children }: { title: string; description?: string; eyebrow?: string; children?: ReactNode }) {
  return <header className="admin-heading"><div><p className="admin-eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p>{description}</p>}</div>{children && <div className="admin-actions">{children}</div>}</header>
}

export function AdminNotice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'success' | 'warning' }) {
  return <div className={`admin-notice admin-notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}><Info size={19} aria-hidden="true" /><div>{children}</div></div>
}

export function AdminBadge({ value }: { value: string }) {
  return <span className={`admin-badge admin-badge-${value.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>{value.replace(/_/g, ' ')}</span>
}

export function AdminPagination({ meta, onPage, disabled = false }: { meta: ListResponse<unknown>['meta']; onPage: (page: number) => void; disabled?: boolean }) {
  return <div className="admin-pagination"><span>{meta.total.toLocaleString()} {meta.total === 1 ? 'result' : 'results'} · Page {meta.page} of {Math.max(1, meta.totalPages)}</span><div className="admin-actions"><button type="button" className="admin-button" disabled={disabled || meta.page <= 1} onClick={() => onPage(meta.page - 1)} aria-label="Previous page"><ArrowLeft size={16} />Previous</button><button type="button" className="admin-button" disabled={disabled || meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)} aria-label="Next page">Next<ArrowRight size={16} /></button></div></div>
}

export function AdminDialog({ open, title, description, onClose, pending = false, children }: { open: boolean; title: string; description?: ReactNode; onClose: () => void; pending?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal()
    if (!open && ref.current?.open) ref.current?.close()
  }, [open])
  return <dialog ref={ref} className="admin-dialog" aria-labelledby={id} aria-describedby={description ? `${id}-description` : undefined} aria-busy={pending} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter(element => element.getClientRects().length > 0)
    const first = items[0], last = items.at(-1)
    if (!first || !last) { event.preventDefault(); return }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }} onCancel={event => { event.preventDefault(); if (!pending) onClose() }} onClick={event => { if (event.target === event.currentTarget && !pending) onClose() }}><div className="admin-dialog-heading"><div><h2 id={id}>{title}</h2>{description && <div id={`${id}-description`} className="admin-help">{description}</div>}</div><button type="button" className="admin-icon-button" aria-label="Close dialog" disabled={pending} onClick={onClose}><X size={20} /></button></div>{open && children}</dialog>
}

export function AdminLoading({ label = 'Loading…' }: { label?: string }) {
  return <div className="admin-loading" role="status"><SpinnerGap size={22} className="admin-spinner" aria-hidden="true" />{label}</div>
}

export function AdminForbidden() {
  return <section className="admin-card admin-empty"><ShieldCheck size={36} /><h1>Permission required</h1><p>Your role does not have access to this section.</p><Link to="/admin" className="admin-button">Return to admin overview<ArrowRight size={16} /></Link></section>
}
