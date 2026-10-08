import { useEffect, useId, useRef, useState } from 'react'
import { X } from '@phosphor-icons/react'
import { ApiError, errorMessageFor } from '../../lib/api'

export function CreatorGroupDialog({ initial = '', onSave, onClose, onRequestClose = onClose, onDirtyChange, onReload }: {
  initial?: string; onSave: (name: string) => Promise<void>; onClose: () => void; onRequestClose?: () => void; onDirtyChange: (dirty: boolean) => void
  onReload?: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const [name, setName] = useState(initial)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  useEffect(() => { onDirtyChange(name !== initial) }, [name, initial, onDirtyChange])
  return <dialog ref={dialog} className="creator-link-dialog" aria-labelledby={title} onCancel={event => { event.preventDefault(); if (!pending) onRequestClose() }}>
    <div className="creator-card-heading"><div><h2 id={title}>{initial ? 'Rename group' : 'New group'}</h2><p>Keep related destinations together on your page.</p></div><button className="creator-icon-button" aria-label="Close" disabled={pending} onClick={onRequestClose}><X size={18} /></button></div>
    <form className="creator-form-grid" onSubmit={event => {
      event.preventDefault()
      if (!name.trim()) { setError('Enter a group name.'); return }
      setPending(true); setError(null)
      void onSave(name.trim()).then(onClose).catch(cause => setError(cause instanceof ApiError ? errorMessageFor(cause) : cause instanceof Error ? cause.message : 'Could not save your group.')).finally(() => setPending(false))
    }}>
      {error && <p className="creator-error" role="alert">{error}</p>}
      {onReload && <button type="button" className="creator-button" disabled={pending} onClick={onReload}>Load latest draft</button>}
      <div className="creator-field"><label htmlFor="creator-group-name">Group name</label><input id="creator-group-name" value={name} onChange={event => setName(event.target.value)} required maxLength={80} autoFocus disabled={pending} placeholder="e.g. Work, Content, Resources" /></div>
      <footer><button type="button" className="creator-button" onClick={onRequestClose} disabled={pending}>Cancel</button><button className="creator-button creator-button-primary" disabled={pending}>{pending ? 'Saving…' : initial ? 'Save group' : 'Create group'}</button></footer>
    </form>
  </dialog>
}
