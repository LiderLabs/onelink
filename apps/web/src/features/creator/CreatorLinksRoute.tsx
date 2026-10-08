import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, Clock, DotsSixVertical, Eye, EyeSlash, Info, Link as LinkIcon, MagnifyingGlass, PencilSimple, Plus, SquaresFour, Stack, Trash } from '@phosphor-icons/react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Splash } from '../../components/StatusScreens'
import { ApiError, errorMessageFor } from '../../lib/api'
import { useUnsavedChanges } from '../../lib/dirty-form'
import { useSession } from '../../lib/session'
import type { OwnerPage, PageDraftContent, PageDraftState, PublicPageOwner } from '../../lib/types'
import { getPageDraft, getPagePreview, savePageDraft } from '../pages/api'
import { CreatorGroupDialog } from './CreatorGroupDialog'
import { CreatorLinkDialog } from './CreatorLinkDialog'
import { CreatorPreview, draftModel } from './CreatorPreview'
import { getSetupPages } from './setup-state'
import './creator-links.css'

type DraftLink = PageDraftContent['links'][number]
type LinkStatus = 'visible' | 'hidden' | 'upcoming' | 'expired'
type Confirmation = { kind: 'delete-links'; ids: string[] } | { kind: 'delete-group'; id: string } | { kind: 'reload' | 'discard' }

function statusOf(link: DraftLink, now: number): LinkStatus {
  if (!link.isVisible) return 'hidden'
  if (link.endsAt !== null && link.endsAt <= now) return 'expired'
  if (link.startsAt !== null && link.startsAt > now) return 'upcoming'
  return 'visible'
}
const statusLabels: Record<LinkStatus, string> = { visible: 'Visible now', hidden: 'Hidden', upcoming: 'Upcoming', expired: 'Expired' }

export function CreatorLinksRoute() {
  const { user } = useSession()
  const [params, setParams] = useSearchParams()
  const requestedPage = params.get('page')
  const [pages, setPages] = useState<OwnerPage[] | null>(null)
  const [pageId, setPageId] = useState<string | null>(null)
  const [draft, setDraft] = useState<PageDraftState | null>(null)
  const [owner, setOwner] = useState<PublicPageOwner | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [pending, setPending] = useState(false)
  const saving = useRef(false)
  const [notice, setNotice] = useState('')
  const [groupFilter, setGroupFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selection, setSelection] = useState<string[]>([])
  const [editor, setEditor] = useState<DraftLink | null | undefined>(undefined)
  const [groupEditor, setGroupEditor] = useState<{ id?: string; name: string } | null>(null)
  const [editorDirty, setEditorDirty] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [now, setNow] = useState(Date.now())
  const dragged = useRef<string | null>(null)
  const autoAdd = useRef('')
  const guard = useUnsavedChanges(editorDirty || pending)
  useEffect(() => {
    document.title = 'My links · OneLink'
    const timer = window.setInterval(() => setNow(Date.now()), 15000)
    const refreshTime = () => setNow(Date.now())
    window.addEventListener('focus', refreshTime)
    return () => { clearInterval(timer); window.removeEventListener('focus', refreshTime) }
  }, [])
  useEffect(() => {
    let current = true
    setLoadError(null); setPages(null)
    void getSetupPages().then(items => {
      if (!current) return
      setPages(items)
      setPageId(id => items.some(page => page.id === requestedPage) ? requestedPage : items.some(page => page.id === id) ? id : (items.find(page => page.status === 'published') ?? items[0])?.id ?? null)
    }).catch(cause => { if (current) setLoadError(cause) })
    return () => { current = false }
  }, [user?.id, requestedPage, retry])
  useEffect(() => {
    if (!pageId) return
    let current = true
    setDraft(null); setOwner(null); setLoadError(null); setError(null); setConflict(false)
    setEditor(undefined); setGroupEditor(null); setEditorDirty(false); setConfirmation(null); setNotice('')
    setSelection([]); setGroupFilter('all'); setSearch(''); setStatusFilter('all')
    void Promise.all([getPageDraft(pageId), getPagePreview(pageId)]).then(([saved, preview]) => {
      if (current) { setDraft(saved.draft); setOwner(preview.page.owner) }
    }).catch(cause => { if (current) setLoadError(cause) })
    return () => { current = false }
  }, [pageId, retry])
  useEffect(() => {
    if (draft && pageId && params.get('add') === '1' && autoAdd.current !== pageId) {
      autoAdd.current = pageId; setEditor(null)
    }
  }, [draft, pageId, params])
  const selectedPage = pages?.find(page => page.id === pageId)

  async function save(content: PageDraftContent, message: string) {
    if (!draft || !pageId || saving.current || conflict) throw new Error(conflict ? 'Load the latest draft before saving more changes.' : 'Your draft is not ready to save.')
    saving.current = true; setPending(true); setError(null); setNotice('')
    try {
      const result = await savePageDraft(pageId, content, draft.updatedAt)
      setDraft(result.draft); setNotice(message); setNow(Date.now())
      setSelection(ids => ids.filter(id => result.draft.content.links.some(link => link.id === id)))
    } catch (cause) {
      const stale = cause instanceof ApiError && ['PRECONDITION_FAILED', 'CONFLICT'].includes(cause.code)
      if (stale) setConflict(true)
      setError(stale ? 'Your draft changed in another tab. Load the latest draft before making more changes.' : errorMessageFor(cause))
      throw cause
    } finally { saving.current = false; setPending(false) }
  }
  function perform(content: PageDraftContent, message: string) { void save(content, message).catch(() => {}) }
  function closeEditor() { setEditor(undefined); setGroupEditor(null); setEditorDirty(false) }
  function requestClose() { if (editorDirty) setConfirmation({ kind: 'discard' }); else closeEditor() }
  async function confirm() {
    if (!confirmation || !draft || !pageId || pending) return
    try {
      if (confirmation.kind === 'discard') closeEditor()
      else if (confirmation.kind === 'reload') {
        saving.current = true; setPending(true)
        const result = await getPageDraft(pageId)
        setDraft(result.draft); setConflict(false); setError(null); setSelection([]); setGroupFilter('all'); closeEditor(); setNotice('Latest draft loaded.')
      } else if (confirmation.kind === 'delete-links') {
        await save({ ...draft.content, links: draft.content.links.filter(link => !confirmation.ids.includes(link.id ?? '')) }, 'Links removed from your draft.')
      } else if (confirmation.kind === 'delete-group') {
        const id = confirmation.id
        await save({ ...draft.content, groups: draft.content.groups.filter(group => group.id !== id), links: draft.content.links.map(link => link.groupId === id ? { ...link, groupId: null } : link) }, 'Group removed. Its links are now ungrouped.')
        setGroupFilter('all')
      }
      setConfirmation(null)
    } catch (cause) { if (confirmation.kind === 'reload') setError(errorMessageFor(cause)) }
    finally { if (confirmation.kind === 'reload') { saving.current = false; setPending(false) } }
  }
  function move(id: string, target: string) {
    if (!draft || id === target) return
    const links = [...draft.content.links]
    const from = links.findIndex(link => link.id === id)
    const to = links.findIndex(link => link.id === target)
    if (from < 0 || to < 0) return
    const moved = links.splice(from, 1)[0]
    if (!moved) return
    links.splice(to, 0, moved)
    perform({ ...draft.content, links }, 'Link order saved.')
  }
  function moveBy(id: string, offset: number, rows: DraftLink[]) {
    const index = rows.findIndex(link => link.id === id)
    const target = rows[index + offset]?.id
    if (target) move(id, target)
  }
  if (loadError) return <ErrorNotice error={loadError} action="Try again" onRetry={() => setRetry(value => value + 1)} />
  if (!pages) return <Splash label="Loading your links" />
  if (!pages.length) return <section className="creator-card creator-empty"><LinkIcon size={32} /><h1>Start your link collection.</h1><p>Claim your page address, then add the places you want people to visit.</p><Link className="creator-button creator-button-primary mt-5" to="/app/onboarding">Create your page<ArrowRight size={17} /></Link></section>
  if (!draft || !owner || !selectedPage) return <Splash label="Loading your saved link collection" />
  const content = draft.content
  const disabled = pending || conflict
  const counts = content.links.reduce((result, link) => { result[statusOf(link, now)]++; return result }, { visible: 0, hidden: 0, upcoming: 0, expired: 0 })
  const filtered = content.links.filter(link => (groupFilter === 'all' || (groupFilter === 'ungrouped' ? !link.groupId : link.groupId === groupFilter)) && (statusFilter === 'all' || statusOf(link, now) === statusFilter) && `${link.title} ${link.url} ${link.description ?? ''}`.toLowerCase().includes(search.toLowerCase().trim()))
  const visibleRows = filtered.filter(link => !['hidden', 'expired'].includes(statusOf(link, now)))
  const hiddenRows = filtered.filter(link => ['hidden', 'expired'].includes(statusOf(link, now)))
  const activeGroup = content.groups.find(group => group.id === groupFilter)
  const editorPath = `/app/pages/${pageId}`
  function renderRow(link: DraftLink) {
    const id = link.id ?? ''
    const state = statusOf(link, now)
    const inactive = ['hidden', 'expired'].includes(state)
    const siblings = inactive ? hiddenRows : visibleRows
    const index = siblings.findIndex(item => item.id === id)
    function canDrop() {
      const source = content.links.find(item => item.id === dragged.current)
      return !disabled && source && ['hidden', 'expired'].includes(statusOf(source, now)) === inactive
    }
    const group = content.groups.find(item => item.id === link.groupId)
    return <article className={`link-manager-row link-manager-row-${state}`} key={id} data-link-id={id} onDragOver={event => { if (canDrop()) event.preventDefault() }} onDrop={event => { event.preventDefault(); if (canDrop() && dragged.current) move(dragged.current, id); dragged.current = null }}>
      <input type="checkbox" aria-label={`Select ${link.title}`} checked={selection.includes(id)} disabled={disabled} onChange={event => setSelection(ids => event.target.checked ? [...ids, id] : ids.filter(item => item !== id))} />
      <span className="link-manager-drag" draggable={!disabled} title="Drag to reorder; arrow buttons also work" onDragStart={event => { dragged.current = id; event.dataTransfer.setData('text/plain', id); event.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => { dragged.current = null }} aria-hidden="true"><DotsSixVertical size={16} /></span>
      <span className="link-manager-destination"><ArrowUpRight size={22} /></span>
      <div className="link-manager-row-content"><h3>{link.title}</h3><p>{link.url}</p>{link.description && <p>{link.description}</p>}<div className="link-manager-tags">{group && <span className="link-manager-tag"><Stack size={13} />{group.name}</span>}<span className={`link-manager-tag link-manager-tag-${state}`}>{statusLabels[state]}</span>{(link.startsAt !== null || link.endsAt !== null) && <span className="link-manager-tag" title={`${link.startsAt === null ? 'No start limit' : `From ${new Date(link.startsAt).toLocaleString()}`} · ${link.endsAt === null ? 'No end limit' : `Until ${new Date(link.endsAt).toLocaleString()}`}`}><Clock size={13} />Time window</span>}</div></div>
      <div className="link-manager-row-actions"><div className="link-manager-arrows">
        <button type="button" aria-label={`Move ${link.title} up`} title="Move up" disabled={disabled || index === 0} onClick={() => moveBy(id, -1, siblings)}><ArrowUp size={14} /></button>
        <button type="button" aria-label={`Move ${link.title} down`} title="Move down" disabled={disabled || index === siblings.length - 1} onClick={() => moveBy(id, 1, siblings)}><ArrowDown size={14} /></button>
      </div><button type="button" aria-label={`${link.isVisible ? 'Hide' : 'Show'} ${link.title}`} title={link.isVisible ? 'Hide link' : 'Show link'} disabled={disabled} onClick={() => perform({ ...content, links: content.links.map(item => item.id === id ? { ...item, isVisible: !item.isVisible } : item) }, 'Link visibility saved.')}>{link.isVisible ? <Eye size={18} /> : <EyeSlash size={18} />}</button><button type="button" aria-label={`Edit ${link.title}`} title="Edit link" disabled={disabled} onClick={() => setEditor(link)}><PencilSimple size={18} /></button><button type="button" aria-label={`Remove ${link.title}`} title="Remove link" disabled={disabled} onClick={() => setConfirmation({ kind: 'delete-links', ids: [id] })}><Trash size={18} /></button></div>
    </article>
  }
  return <div className="link-manager">
    <header className="creator-heading"><div><p className="creator-eyebrow">Your workspace · Link manager</p><h1>Manage your links<span className="creator-accent">.</span></h1><p>Add, group and reorder everything you want visitors to find.</p></div><div className="creator-actions"><Link className="creator-button" to="/app/dashboard"><SquaresFour size={18} />Dashboard</Link><button className="creator-button creator-button-primary" disabled={disabled || content.links.length >= 200} onClick={() => setEditor(null)}><Plus size={18} />Add new link</button></div></header>
    {pages.length > 1 && <div className="creator-field link-manager-page-picker"><label htmlFor="link-manager-page">Your pages</label><select id="link-manager-page" value={pageId ?? ''} disabled={pending || editorDirty} onChange={event => { setPageId(event.target.value); setParams({ page: event.target.value }) }}>{pages.map(page => <option key={page.id} value={page.id}>{page.title || page.slug}</option>)}</select></div>}
    <p className="creator-notice link-manager-draft-notice"><Info size={18} /><span><strong>Private draft.</strong> Link changes are saved to your account. Use Review & Publish when you’re ready to update your public page.</span></p>
    {error && <div className="creator-error" role="alert"><p>{error}</p>{conflict && <button className="creator-button mt-3" onClick={() => setConfirmation({ kind: 'reload' })} disabled={pending}>Load latest draft</button>}</div>}
    <div className="link-manager-save-status" role="status" aria-live="polite">{pending ? 'Saving your draft…' : notice || 'Your saved link collection'}</div>
    <section className="creator-metrics" aria-label="Link collection summary">{[
      { title: 'Total links', value: content.links.length, icon: LinkIcon }, { title: 'Visible now', value: counts.visible, icon: Eye }, { title: 'Hidden / expired', value: counts.hidden + counts.expired, icon: EyeSlash }, { title: 'Upcoming', value: counts.upcoming, icon: Clock },
    ].map(({ title, value, icon: Icon }) => <div className="creator-card link-manager-metric" key={title}><div><p>{title}</p><strong>{value}</strong></div><span className="link-manager-destination"><Icon size={24} /></span></div>)}</section>
    <div className="link-manager-grid"><div className="creator-stack"><section className="creator-card link-manager-collection"><div className="creator-card-heading"><div><h2>Your link collection</h2><p>Organize destinations with groups, filters and visibility controls.</p></div><button className="creator-button" disabled={disabled || content.groups.length >= 100} onClick={() => setGroupEditor({ name: '' })}><Plus size={16} />New group</button></div>
      <div className="link-manager-groups" role="group" aria-label="Filter by group">{[{ id: 'all', name: 'All links', count: content.links.length }, { id: 'ungrouped', name: 'Ungrouped', count: content.links.filter(link => !link.groupId).length }, ...content.groups.map(group => ({ id: group.id!, name: group.name, count: content.links.filter(link => link.groupId === group.id).length }))].map(group => <button key={group.id} aria-pressed={groupFilter === group.id} onClick={() => { setGroupFilter(group.id); setSelection([]) }}>{group.name}<span>{group.count}</span></button>)}</div>
      {activeGroup && <div className="link-manager-group-actions"><span>{activeGroup.name}</span><button className="creator-text-link" disabled={disabled} onClick={() => setGroupEditor(activeGroup)}>Rename group</button><button className="creator-text-link" disabled={disabled} onClick={() => setConfirmation({ kind: 'delete-group', id: activeGroup.id! })}>Remove group</button></div>}
      <div className="link-manager-filters"><div className="creator-field link-manager-search"><label className="sr-only" htmlFor="link-manager-search">Search links</label><MagnifyingGlass size={17} /><input id="link-manager-search" type="search" value={search} placeholder="Search links by name or URL" onChange={event => setSearch(event.target.value)} /></div><div className="creator-field"><label className="sr-only" htmlFor="link-manager-status">Link status</label><select id="link-manager-status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">All statuses</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>
      <div className="link-manager-result-heading"><label><input type="checkbox" aria-label="Select all filtered links" disabled={disabled || filtered.length === 0} checked={filtered.length > 0 && filtered.every(link => selection.includes(link.id!))} onChange={event => setSelection(event.target.checked ? filtered.map(link => link.id!) : [])} />{activeGroup?.name || 'All your links'}</label><span>{filtered.length} results · Drag or use arrows</span></div>
      {selection.length > 0 && <div className="link-manager-bulk"><strong>{selection.length} selected</strong><button className="creator-button" disabled={disabled} onClick={() => perform({ ...content, links: content.links.map(link => selection.includes(link.id!) ? { ...link, isVisible: true } : link) }, 'Selected links shown in your draft.')}>Show</button><button className="creator-button" disabled={disabled} onClick={() => perform({ ...content, links: content.links.map(link => selection.includes(link.id!) ? { ...link, isVisible: false } : link) }, 'Selected links hidden.')}>Hide</button><div className="creator-field"><label className="sr-only" htmlFor="bulk-link-group">Move selected to group</label><select id="bulk-link-group" value="" disabled={disabled} onChange={event => perform({ ...content, links: content.links.map(link => selection.includes(link.id!) ? { ...link, groupId: event.target.value === 'ungrouped' ? null : event.target.value } : link) }, 'Selected links moved.')}><option value="" disabled>Move to group…</option><option value="ungrouped">Ungrouped</option>{content.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></div><button className="creator-icon-button" aria-label="Remove selected links" disabled={disabled} onClick={() => setConfirmation({ kind: 'delete-links', ids: selection })}><Trash size={18} /></button><button className="creator-text-link" onClick={() => setSelection([])}>Clear</button></div>}
      <div className="link-manager-rows">{visibleRows.map(renderRow)}{hiddenRows.length > 0 && <div className="link-manager-divider"><span>Hidden, expired or inactive · {hiddenRows.length}</span></div>}{hiddenRows.map(renderRow)}</div>
      {filtered.length === 0 && <div className="creator-empty"><LinkIcon size={30} /><h3>{content.links.length ? 'No links match your filters.' : 'No links added yet'}</h3><p>{content.links.length ? 'Try another group, search or status.' : 'Your first link is one click away. Start with your portfolio, shop or favorite project.'}</p>{content.links.length ? <button className="creator-button mt-5" onClick={() => { setSearch(''); setStatusFilter('all'); setGroupFilter('all') }}>Clear filters</button> : <button className="creator-button creator-button-primary mt-5" disabled={disabled} onClick={() => setEditor(null)}>Add your first link<Plus size={17} /></button>}</div>}
    </section><section className="creator-card link-manager-publish"><div><h2>Ready to share an update?</h2><p>Your changes stay in the draft until you publish.</p></div><ArrowRight size={24} /><div className="creator-actions"><Link className="creator-button" to={`${editorPath}#appearance-heading`}>Customize page</Link><Link className="creator-button creator-button-primary" to={`${editorPath}?tab=publish`}>Review & Publish<ArrowRight size={17} /></Link></div></section></div>
    <section className="creator-card link-manager-preview"><CreatorPreview page={draftModel(selectedPage.slug, content, owner)} compact /><p className="link-manager-preview-note"><Info size={16} />Only visible links within their scheduled window appear. This preview uses your saved draft.</p></section></div>
    {editor !== undefined && <CreatorLinkDialog initial={editor ?? undefined} groups={content.groups} scheduling onDirtyChange={setEditorDirty} onReload={conflict ? () => setConfirmation({ kind: 'reload' }) : undefined} onRequestClose={requestClose} onClose={closeEditor} onSave={async link => { await save({ ...content, links: editor?.id ? content.links.map(item => item.id === editor.id ? link : item) : [...content.links, link] }, 'Link saved to your draft.') }} />}
    {groupEditor && <CreatorGroupDialog initial={groupEditor.name} onDirtyChange={setEditorDirty} onReload={conflict ? () => setConfirmation({ kind: 'reload' }) : undefined} onClose={closeEditor} onRequestClose={requestClose} onSave={async name => { await save({ ...content, groups: groupEditor.id ? content.groups.map(group => group.id === groupEditor.id ? { ...group, name } : group) : [...content.groups, { name }] }, 'Group saved to your draft.') }} />}
    <ConfirmDialog open={confirmation !== null} title={confirmation?.kind === 'reload' ? 'Load the latest draft?' : confirmation?.kind === 'discard' ? 'Discard these unsaved changes?' : confirmation?.kind === 'delete-group' ? 'Remove this group?' : `Remove ${confirmation?.kind === 'delete-links' ? confirmation.ids.length : ''} selected link${confirmation?.kind === 'delete-links' && confirmation.ids.length === 1 ? '' : 's'}?`} confirmLabel={confirmation?.kind === 'reload' ? 'Load latest draft' : confirmation?.kind === 'discard' ? 'Discard changes' : confirmation?.kind === 'delete-group' ? 'Remove group' : 'Remove links'} pending={pending} onCancel={() => setConfirmation(null)} onConfirm={() => void confirm()}>{confirmation?.kind === 'reload' ? 'This replaces the version shown here with the latest saved draft. Unsaved dialog changes will be discarded.' : confirmation?.kind === 'discard' ? 'Your saved draft stays intact. Changes in this dialog will be lost.' : confirmation?.kind === 'delete-group' ? 'The group will be removed from your draft. Its links will stay in your collection as ungrouped links.' : 'These links will be removed from your draft. Your public page changes only when you publish.'}{error && confirmation?.kind !== 'discard' && <div role="alert" className="creator-error mt-4">{error}{conflict && confirmation?.kind !== 'reload' && <button className="creator-button mt-3" disabled={pending} onClick={() => setConfirmation({ kind: 'reload' })}>Load latest draft</button>}</div>}</ConfirmDialog>
    <ConfirmDialog open={guard.blocked} title="Leave with unsaved changes?" confirmLabel="Leave page" pending={pending} onCancel={guard.stay} onConfirm={guard.proceed}>The changes in this dialog have not been saved to your draft.</ConfirmDialog>
  </div>
}
