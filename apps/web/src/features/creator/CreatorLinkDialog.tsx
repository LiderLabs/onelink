import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Plus, X } from '@phosphor-icons/react'
import type { PageDraftContent } from '../../lib/types'
import { errorMessageFor } from '../../lib/api'

type DraftLink = PageDraftContent['links'][number]
const emptyLink: DraftLink = { title: '', url: '', description: null, icon: null, isVisible: true, groupId: null, openInNewTab: true, thumbnailKey: null, startsAt: null, endsAt: null }

export function CreatorLinkDialog({ initial, groups, scheduling = false, onSave, onClose, onRequestClose = onClose, onDirtyChange, onReload }: {
  initial?: DraftLink; groups?: PageDraftContent['groups']; scheduling?: boolean
  onSave: (link: DraftLink) => Promise<void>; onClose: () => void; onRequestClose?: () => void; onDirtyChange?: (dirty: boolean) => void
  onReload?: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [values, setValues] = useState<DraftLink>(() => ({ ...(initial ?? emptyLink) }))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  useEffect(() => { onDirtyChange?.(JSON.stringify(values) !== JSON.stringify(initial ?? emptyLink)) }, [values, initial, onDirtyChange])
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null)
    try {
      const url = new URL(values.url.trim())
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use a full http:// or https:// URL without embedded credentials.')
      if (!values.title.trim()) throw new Error('Give your link a button title.')
      if (values.startsAt !== null && (!Number.isFinite(values.startsAt) || values.startsAt < 0) || values.endsAt !== null && (!Number.isFinite(values.endsAt) || values.endsAt < 0)) throw new Error('Choose a valid date and time after January 1, 1970.')
      if (values.startsAt !== null && values.endsAt !== null && values.endsAt <= values.startsAt) throw new Error('Visible until must be later than visible from.')
      setPending(true)
      await onSave({ ...values, title: values.title.trim(), url: url.href, description: values.description?.trim() || null })
      onClose()
    } catch (cause) { setError(cause instanceof Error && !(cause as { code?: string }).code ? cause.message : errorMessageFor(cause)) }
    finally { setPending(false) }
  }
  return <dialog ref={dialog} className="creator-link-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!pending) onRequestClose() }}>
    <div className="creator-card-heading"><div><h2 id={titleId}>{initial ? 'Edit your link' : 'Add a link'}</h2><p>Paste a URL, then give your link a clear title.</p></div><button type="button" aria-label="Close" className="creator-icon-button" disabled={pending} onClick={onRequestClose}><X size={18} /></button></div>
    <form onSubmit={event => void submit(event)} className="creator-form-grid">
      {error && <div className="creator-error" role="alert">{error}</div>}
      {onReload && <button type="button" className="creator-button" disabled={pending} onClick={onReload}>Load latest draft</button>}
      <div className="creator-field"><label htmlFor="creator-link-url">Destination URL</label><input id="creator-link-url" type="url" required autoFocus maxLength={2048} placeholder="https://yourwebsite.com" value={values.url} onChange={event => setValues({ ...values, url: event.target.value })} disabled={pending} /><p>Use a full website URL starting with https://</p></div>
      <div className="creator-field"><label htmlFor="creator-link-title">Button title</label><input id="creator-link-title" required maxLength={140} placeholder="e.g. My portfolio" value={values.title} onChange={event => setValues({ ...values, title: event.target.value })} disabled={pending} /></div>
      <div className="creator-field"><label htmlFor="creator-link-description">Description <span>Optional</span></label><textarea id="creator-link-description" maxLength={280} placeholder="A little more context about this link" value={values.description ?? ''} onChange={event => setValues({ ...values, description: event.target.value })} disabled={pending} /></div>
      {groups && <div className="creator-field"><label htmlFor="creator-link-group">Group</label><select id="creator-link-group" value={values.groupId ?? ''} onChange={event => setValues({ ...values, groupId: event.target.value || null })} disabled={pending}><option value="">Ungrouped</option>{groups.filter(group => group.id).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></div>}
      <label className="creator-checkbox"><span>Show on my page<small>Turn off to keep this link hidden</small></span><input type="checkbox" checked={values.isVisible} onChange={event => setValues({ ...values, isVisible: event.target.checked })} disabled={pending} /></label>
      <label className="creator-checkbox"><span>Open in a new tab<small>Recommended for external links</small></span><input type="checkbox" checked={values.openInNewTab} onChange={event => setValues({ ...values, openInNewTab: event.target.checked })} disabled={pending} /></label>
      {scheduling && <fieldset className="link-manager-schedule"><legend>Scheduling <span>Optional</span></legend><div className="creator-field-pair">{(['startsAt', 'endsAt'] as const).map(key => <div className="creator-field" key={key}><label htmlFor={`creator-link-${key}`}>{key === 'startsAt' ? 'Visible from' : 'Visible until'}</label><input type="datetime-local" id={`creator-link-${key}`} value={localDateTime(values[key])} onChange={event => setValues({ ...values, [key]: event.target.value ? new Date(event.target.value).getTime() : null })} disabled={pending} /></div>)}</div><p>Times use {Intl.DateTimeFormat().resolvedOptions().timeZone}. Leave either end empty for no limit. Your schedule takes effect after publishing.</p></fieldset>}
      <div className="creator-actions" style={{ justifyContent: 'flex-end' }}><button type="button" className="creator-button" onClick={onRequestClose} disabled={pending}>Cancel</button><button className="creator-button creator-button-primary" disabled={pending}>{pending ? 'Saving…' : initial ? 'Save link' : 'Add link'}<Plus size={16} /></button></div>
    </form>
  </dialog>
}

function localDateTime(timestamp: number | null) {
  if (timestamp === null || !Number.isFinite(timestamp)) return ''
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
