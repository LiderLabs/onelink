import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessageFor } from '../../lib/api'
import { useUnsavedChanges } from '../../lib/dirty-form'
import { useSession } from '../../lib/session'
import { AdminDialog, AdminForbidden, AdminHeading, AdminLoading, AdminNotice } from './AdminUI'
import { patchAdminSettings, readAdminSettings } from './settings-api'
import type { AdminSetting, SettingPatch } from './settings-api'
import './admin-settings-audit.css'

function encode(setting: AdminSetting): string {
  return setting.type === 'json' ? JSON.stringify(setting.value, null, 2) : String(setting.value ?? '')
}

function parse(setting: AdminSetting, draft: string): { value: unknown; error?: string } {
  if (setting.type === 'boolean') return { value: draft === 'true' }
  if (setting.type === 'number') {
    const value = Number(draft)
    return draft.trim() !== '' && Number.isFinite(value) ? { value } : { value: null, error: 'Enter a finite number.' }
  }
  if (setting.type === 'json') {
    try { return { value: JSON.parse(draft) } }
    catch { return { value: null, error: 'Enter valid JSON.' } }
  }
  return { value: draft }
}

const GROUP_LABELS: Record<string, string> = {
  platform: 'Platform & registration', moderation: 'Moderation policy', content: 'Content & addresses',
  appeals: 'Appeals policy', audit: 'Audit & retention', analytics: 'Analytics retention', general: 'General policy',
}

export function AdminSettingsRoute() {
  const { can, user } = useSession()
  const canRead = can('settings.read')
  const canWrite = user?.role === 'owner' && can('settings.update')
  const [records, setRecords] = useState<AdminSetting[] | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [reload, setReload] = useState(0)
  const recordsRef = useRef<AdminSetting[]>([])
  const draftsRef = useRef<Record<string, string>>({})
  const pendingRef = useRef(false)
  const mounted = useRef(true)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!canRead) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    readAdminSettings().then(result => {
      if (cancelled) return
      const next = Object.fromEntries(result.map(setting => [setting.key, encode(setting)]))
      recordsRef.current = result
      draftsRef.current = next
      setRecords(result)
      setDrafts(next)
      setLoading(false)
    }).catch(error => {
      if (!cancelled) { setLoadError(errorMessageFor(error)); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [canRead, reload])

  const changed = (records ?? []).filter(setting => drafts[setting.key] !== encode(setting))
  const dirty = changed.length > 0
  const guard = useUnsavedChanges(canWrite && (dirty || pending))
  const errors = Object.fromEntries(changed.map(setting => [setting.key, parse(setting, drafts[setting.key] ?? '').error]))
  const invalid = Object.values(errors).some(Boolean)

  const save = useCallback(async () => {
    if (!canWrite || pendingRef.current) return
    const snapshot = { ...draftsRef.current }
    const patches: SettingPatch[] = []
    for (const setting of recordsRef.current) {
      const draft = snapshot[setting.key] ?? encode(setting)
      if (draft === encode(setting)) continue
      const parsed = parse(setting, draft)
      if (!parsed.error) patches.push({ key: setting.key, value: parsed.value })
      if (patches.length === 100) break
    }
    if (!patches.length) return
    pendingRef.current = true
    setPending(true)
    try {
      const result = await patchAdminSettings(patches)
      if (!mounted.current) return
      const confirmed = new Map(result.settings.map(setting => [setting.key, setting]))
      // A response confirms the values sent. Edits made since that snapshot stay
      // in the draft and are saved by the next, sequential request.
      const nextRecords = recordsRef.current.map(setting => confirmed.get(setting.key) ?? setting)
      const nextDrafts = { ...draftsRef.current }
      for (const setting of result.settings) {
        if (nextDrafts[setting.key] === snapshot[setting.key]) nextDrafts[setting.key] = encode(setting)
      }
      recordsRef.current = nextRecords
      draftsRef.current = nextDrafts
      setRecords(nextRecords)
      setDrafts(nextDrafts)
      setSaveError(null)
      setSavedAt(Date.now())
    } catch (error) {
      if (mounted.current) setSaveError(errorMessageFor(error))
    } finally {
      pendingRef.current = false
      if (mounted.current) setPending(false)
    }
  }, [canWrite])

  useEffect(() => {
    if (!canWrite || !dirty || pending || saveError || guard.blocked) return
    const timer = window.setTimeout(() => { void save() }, 600)
    return () => window.clearTimeout(timer)
  }, [canWrite, dirty, drafts, pending, saveError, save, guard.blocked])

  const edit = (key: string, value: string) => {
    if (!canWrite) return
    const next = { ...draftsRef.current, [key]: value }
    draftsRef.current = next
    setDrafts(next)
  }

  if (!canRead) return <AdminForbidden />
  const groups = [...new Set((records ?? []).map(setting => setting.group ?? 'general'))]
  const saveLabel = pending ? 'Saving changes…' : dirty ? (invalid ? 'Review invalid fields' : 'Unsaved changes') : savedAt ? 'All changes saved' : 'Settings are up to date'

  return <div className="admin-stack admin-settings">
    <AdminHeading title="Platform settings" description="Registration, content limits, and the policies that keep OneLink running." eyebrow="Platform policy">
      <span className={`admin-save-state ${pending || dirty ? 'is-pending' : ''}`} role="status" aria-live="polite">{saveLabel}</span>
    </AdminHeading>
    {!canWrite && <AdminNotice>Only an owner can change platform settings. Your access is read-only.</AdminNotice>}
    {canWrite && !loading && <p className="admin-help">Valid changes save automatically. Changes apply after the server confirms them.</p>}
    {loadError && <AdminNotice tone="error"><p>{loadError}</p><button className="admin-button" onClick={() => setReload(value => value + 1)}>Retry settings</button></AdminNotice>}
    {saveError && <AdminNotice tone="error"><p>{saveError}</p><p>Your edits are still here. Retry to save the latest values.</p><button className="admin-button" disabled={pending} onClick={() => { void save() }}>Retry save</button></AdminNotice>}
    {loading && <AdminLoading label="Loading platform settings" />}
    {!loading && records?.length === 0 && <div className="admin-card admin-empty">No platform settings are configured.</div>}
    {!loading && groups.map(group => <section className="admin-card admin-policy-panel" key={group} aria-labelledby={`group-${group}`}>
      <div className="admin-policy-heading"><h2 id={`group-${group}`}>{GROUP_LABELS[group] ?? group.replace(/[._-]/g, ' ')}</h2><span>{records?.filter(setting => (setting.group ?? 'general') === group).length} settings</span></div>
      {records?.filter(setting => (setting.group ?? 'general') === group).map(setting => {
        const id = `setting-${setting.key}`
        const descriptionId = `${id}-description`
        const errorId = `${id}-error`
        const label = setting.label ?? setting.key
        const error = errors[setting.key]
        return <div className={`admin-policy-row ${setting.type === 'boolean' ? 'is-toggle' : ''}`} key={setting.key}>
          <div className="admin-policy-copy"><label htmlFor={id}>{label}</label><p id={descriptionId}>{setting.description ?? setting.key}</p><span className="admin-policy-key">{setting.key}{setting.isPublic ? ' · Public' : ''}</span></div>
          <div className="admin-policy-control">
            {setting.type === 'boolean' ? <label className="admin-policy-switch"><input id={id} aria-label={label} type="checkbox" checked={drafts[setting.key] === 'true'} disabled={!canWrite} aria-describedby={descriptionId} onChange={event => edit(setting.key, String(event.target.checked))} /><span aria-hidden="true" /><small aria-hidden="true">{drafts[setting.key] === 'true' ? 'Enabled' : 'Disabled'}</small></label> : setting.type === 'json' ? <textarea className="admin-field admin-json-input" id={id} value={drafts[setting.key] ?? ''} disabled={!canWrite} rows={5} spellCheck={false} aria-invalid={Boolean(error)} aria-describedby={`${descriptionId}${error ? ` ${errorId}` : ''}`} onChange={event => edit(setting.key, event.target.value)} /> : <input className="admin-field" id={id} type={setting.type === 'number' ? 'number' : 'text'} step={setting.type === 'number' ? 'any' : undefined} value={drafts[setting.key] ?? ''} disabled={!canWrite} aria-invalid={Boolean(error)} aria-describedby={`${descriptionId}${error ? ` ${errorId}` : ''}`} onChange={event => edit(setting.key, event.target.value)} />}
            {error && <p className="admin-policy-error" id={errorId} role="alert">{error}</p>}
          </div>
        </div>
      })}
    </section>)}
    <div className="admin-policy-unavailable">
      <section className="admin-card"><span className="admin-policy-key">Unavailable</span><h2>Email templates</h2><p className="admin-help">Template editing is not available in this workspace. Contact the platform maintainer to update email content.</p><button className="admin-button" disabled>Edit email templates</button></section>
      <section className="admin-card"><span className="admin-policy-key">Unavailable</span><h2>Rate-limit rules</h2><p className="admin-help">Rate-limit rule editing is not available in this workspace. Contact the platform maintainer to update request limits.</p><button className="admin-button" disabled>Edit rate limits</button></section>
    </div>
    <AdminDialog open={guard.blocked} title="Leave with unsaved changes?" description={pending ? 'A save is still in progress. Wait for it to finish before leaving.' : 'Your latest changes have not been confirmed by the server.'} onClose={guard.stay} pending={pending}>
      <div className="admin-actions"><button className="admin-button" onClick={guard.stay} disabled={pending} autoFocus>Stay here</button><button className="admin-button admin-button-danger" onClick={guard.proceed} disabled={pending}>Leave without saving</button></div>
    </AdminDialog>
  </div>
}
