import { useState } from 'react'
import { Button } from '../../components/Button'
import { CheckboxField, Field, SelectField, TextareaField } from '../../components/Field'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { Icon } from '../../components/Icon'
import { IconButton } from '../../components/IconButton'
import { PageHeader } from '../../components/PageHeader'
import { Panel } from '../../components/Panel'
import { cx } from '../../lib/css'
import { AddLinkDialog } from './AddLinkDialog'
import type { NewLinkInput } from './AddLinkDialog'
import { newKey, useEditor } from './context'
import type { EditorLink } from './context'

// ============================================================================
// The Links tab.
//
// The links themselves and their order are the page draft's, so every edit here
// autosaves and Publish promotes it — the "unpublished changes" bar below is the
// same one the whole editor shares.
//
// Reordering uses the browser's own HTML5 drag events. That is a deliberate
// choice over a dependency: it needs no library, it degrades to nothing on touch
// (where the row's up/down keys still work), and it keeps the bundle honest.
// Every action — show/hide, edit, delete — is on the row it affects, and none of
// them touches the network directly.
// ============================================================================

interface LinkEditDraft {
  title: string
  url: string
  description: string
  groupId: string
  openInNewTab: boolean
}

function draftOf(link: EditorLink): LinkEditDraft {
  return {
    title: link.title,
    url: link.url,
    description: link.description,
    groupId: link.groupId ?? '',
    openInNewTab: link.openInNewTab,
  }
}

export function LinksTab() {
  const { links, groups, setLinks, setGroups, page, canManage } = useEditor()
  const [filter, setFilter] = useState<string>('all')
  const [addOpen, setAddOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<LinkEditDraft | null>(null)
  const [removing, setRemoving] = useState<EditorLink | null>(null)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [newGroup, setNewGroup] = useState('')

  // Only groups the server knows can be assigned (see contentFromState).
  const assignableGroups = groups.filter((group) => group.id !== null)
  const groupOptions = [{ value: '', label: 'No group' }, ...assignableGroups.map((group) => ({ value: group.id as string, label: group.name }))]

  const activeLinks = links.filter((link) => link.isVisible && (filter === 'all' || link.groupId === filter))
  const hiddenLinks = links.filter((link) => !link.isVisible)
  const countFor = (groupId: string) => links.filter((link) => link.groupId === groupId).length

  const addLink = (input: NewLinkInput) => {
    setLinks((current) => [...current, { key: newKey(), id: null, ...input }])
  }

  const patchLink = (key: string, patch: Partial<EditorLink>) => {
    setLinks((current) => current.map((link) => (link.key === key ? { ...link, ...patch } : link)))
  }

  const toggleVisible = (key: string) => {
    setLinks((current) => current.map((link) => (link.key === key ? { ...link, isVisible: !link.isVisible } : link)))
  }

  const removeLink = (link: EditorLink) => {
    setLinks((current) => current.filter((candidate) => candidate.key !== link.key))
    setRemoving(null)
  }

  const move = (fromKey: string, toKey: string) => {
    if (fromKey === toKey) return
    setLinks((current) => {
      const from = current.findIndex((link) => link.key === fromKey)
      const to = current.findIndex((link) => link.key === toKey)
      if (from < 0 || to < 0) return current
      const next = [...current]
      const [moved] = next.splice(from, 1)
      if (!moved) return current
      next.splice(to, 0, moved)
      return next
    })
  }

  const shift = (link: EditorLink, delta: number) => {
    setLinks((current) => {
      const index = current.findIndex((candidate) => candidate.key === link.key)
      const target = index + delta
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      const [moved] = next.splice(index, 1)
      if (!moved) return current
      next.splice(target, 0, moved)
      return next
    })
  }

  const startEdit = (link: EditorLink) => {
    setEditingKey(link.key)
    setEditDraft(draftOf(link))
  }

  const commitEdit = (link: EditorLink) => {
    if (!editDraft) return
    patchLink(link.key, {
      title: editDraft.title,
      url: editDraft.url,
      description: editDraft.description,
      groupId: editDraft.groupId === '' ? null : editDraft.groupId,
      openInNewTab: editDraft.openInNewTab,
    })
    setEditingKey(null)
    setEditDraft(null)
  }

  const addGroup = () => {
    const name = newGroup.trim()
    if (!name) return
    setGroups((current) => [...current, { key: newKey(), id: null, name }])
    setNewGroup('')
  }

  const updateEdit = (patch: Partial<LinkEditDraft>) => {
    setEditDraft((current) => (current ? { ...current, ...patch } : current))
  }

  const nameFor = (groupId: string | null) =>
    groups.find((group) => group.id === groupId || group.key === groupId)?.name

  const chip = (active: boolean) =>
    cx(
      'inline-flex items-center gap-1.5 border px-3 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.12em] transition-colors',
      active ? 'border-ink bg-ink text-paper' : 'border-rule text-ink-soft hover:border-ink hover:text-ink',
    )

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Destinations"
        title="Manage Links"
        description="Add, reorder, and group the links and media cards on your page. Drag a row by its handle to reorder."
        actions={<Button size="sm" disabled={!canManage} onClick={() => setAddOpen(true)}><Icon name="plus" size={16} /> Add Link</Button>}
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-3 border border-rule bg-white/80 px-4 py-3">
        <span className="eyebrow">Groups</span>
        <button type="button" className={chip(filter === 'all')} onClick={() => setFilter('all')}>
          All <span className="tabular-nums">{links.length}</span>
        </button>
        {groups.map((group) => {
          const id = group.id ?? group.key
          return (
            <button key={group.key} type="button" className={chip(filter === id)} onClick={() => setFilter(id)}>
              {group.name} <span className="tabular-nums">{countFor(id)}</span>
            </button>
          )
        })}
        <div className="ml-auto flex items-center gap-2">
          <input
            value={newGroup}
            onChange={(event) => setNewGroup(event.currentTarget.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addGroup() } }}
            disabled={!canManage}
            placeholder="New group"
            aria-label="New group name"
            className="w-36 border-b border-rule bg-transparent py-1.5 text-sm focus:border-ink focus:outline-none"
          />
          <Button size="sm" variant="outline" disabled={!canManage || newGroup.trim() === ''} onClick={addGroup}>Add group</Button>
        </div>
      </div>

      <Panel
        eyebrow={`${activeLinks.length} shown`}
        title="Active links"
        description="What visitors see. Drag a row by its handle to reorder, or use the eye to hide one without deleting it."
      >
        {activeLinks.length === 0 ? (
          <EmptyState
            title="No active links"
            action={<Button size="sm" disabled={!canManage} onClick={() => setAddOpen(true)}>Add your first link</Button>}
          >
            Nothing is showing yet. Add a link to give visitors somewhere to go.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-rule border-y border-rule">
            {activeLinks.map((link) => {
              const groupName = nameFor(link.groupId)
              const editing = editingKey === link.key && editDraft !== null
              return (
                <li
                  key={link.key}
                  draggable={canManage && !editing}
                  onDragStart={() => setDragKey(link.key)}
                  onDragOver={(event) => { if (dragKey) event.preventDefault() }}
                  onDrop={() => { if (dragKey) { move(dragKey, link.key); setDragKey(null) } }}
                  className={cx('bg-white/80 transition-opacity', dragKey === link.key && 'opacity-50')}
                >
                  {editing ? (
                    <div className="space-y-4 py-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Title" value={editDraft.title} maxLength={140} onChange={(event) => updateEdit({ title: event.currentTarget.value })} />
                        <Field label="URL" value={editDraft.url} onChange={(event) => updateEdit({ url: event.currentTarget.value })} />
                      </div>
                      <TextareaField label="Description" rows={2} value={editDraft.description} maxLength={280} onChange={(event) => updateEdit({ description: event.currentTarget.value })} />
                      {assignableGroups.length > 0 ? (
                        <SelectField label="Group" value={editDraft.groupId} options={groupOptions} onChange={(event) => updateEdit({ groupId: event.currentTarget.value })} />
                      ) : null}
                      <CheckboxField label="Open in a new tab" checked={editDraft.openInNewTab} onChange={(event) => updateEdit({ openInNewTab: event.currentTarget.checked })} />
                      <div className="flex flex-wrap items-center gap-3">
                        <Button size="sm" onClick={() => commitEdit(link)}>Save link</Button>
                        <Button size="sm" variant="outline" onClick={() => { setEditingKey(null); setEditDraft(null) }}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3 py-3">
                      <span aria-hidden="true" className="mt-1.5 cursor-grab text-ink-faint"><Icon name="grip" size={18} /></span>
                      <span aria-hidden="true" className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center border border-rule"><Icon name="links" size={16} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{link.title || 'Untitled link'}</span>
                          {groupName ? <span className="stamp">{groupName}</span> : null}
                        </div>
                        <p className="mt-0.5 truncate font-mono text-[0.6875rem] text-ink-soft">{link.url}</p>
                        {link.description ? <p className="mt-1 text-sm leading-relaxed text-ink-soft">{link.description}</p> : null}
                      </div>
                      <div className="flex shrink-0 items-center">
                        <IconButton icon="chevron-down" label={`Move ${link.title} down`} onClick={() => shift(link, 1)} disabled={!canManage} className="hidden h-8 w-8 sm:grid" />
                        <IconButton icon="chevron-down" label={`Move ${link.title} up`} onClick={() => shift(link, -1)} disabled={!canManage} className="hidden h-8 w-8 rotate-180 sm:grid" />
                        <IconButton icon={link.isVisible ? 'eye' : 'eye-off'} label={link.isVisible ? `Hide ${link.title}` : `Show ${link.title}`} onClick={() => toggleVisible(link.key)} disabled={!canManage} />
                        <IconButton icon="edit" label={`Edit ${link.title}`} onClick={() => startEdit(link)} disabled={!canManage} />
                        <IconButton icon="trash" label={`Delete ${link.title}`} tone="danger" onClick={() => setRemoving(link)} disabled={!canManage} />
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      {hiddenLinks.length > 0 ? (
        <Panel
          eyebrow={`${hiddenLinks.length} hidden`}
          title="Hidden links"
          description="Kept in your list but left off your public page. Show one to bring it back."
        >
          <ul className="divide-y divide-rule border-y border-rule">
            {hiddenLinks.map((link) => {
              const editing = editingKey === link.key && editDraft !== null
              return (
                <li key={link.key} className={cx('transition-opacity', !editing && 'opacity-70')}>
                  {editing ? (
                    <div className="space-y-4 py-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Title" value={editDraft.title} maxLength={140} onChange={(event) => updateEdit({ title: event.currentTarget.value })} />
                        <Field label="URL" value={editDraft.url} onChange={(event) => updateEdit({ url: event.currentTarget.value })} />
                      </div>
                      <TextareaField label="Description" rows={2} value={editDraft.description} maxLength={280} onChange={(event) => updateEdit({ description: event.currentTarget.value })} />
                      <div className="flex flex-wrap items-center gap-3">
                        <Button size="sm" onClick={() => commitEdit(link)}>Save link</Button>
                        <Button size="sm" variant="outline" onClick={() => { setEditingKey(null); setEditDraft(null) }}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3 py-3">
                      <span aria-hidden="true" className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center border border-rule"><Icon name="links" size={16} /></span>
                      <div className="min-w-0 flex-1">
                        <span className="font-medium line-through decoration-ink-faint">{link.title || 'Untitled link'}</span>
                        <p className="mt-0.5 truncate font-mono text-[0.6875rem] text-ink-soft">{link.url}</p>
                      </div>
                      <div className="flex shrink-0 items-center">
                        <IconButton icon="eye-off" label={`Show ${link.title}`} onClick={() => toggleVisible(link.key)} disabled={!canManage} />
                        <IconButton icon="edit" label={`Edit ${link.title}`} onClick={() => startEdit(link)} disabled={!canManage} />
                        <IconButton icon="trash" label={`Delete ${link.title}`} tone="danger" onClick={() => setRemoving(link)} disabled={!canManage} />
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </Panel>
      ) : null}

      <AddLinkDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        pageId={page.id}
        groups={assignableGroups}
        onSubmit={addLink}
      />

      <ConfirmDialog
        open={removing !== null}
        title={`Delete “${removing?.title.trim() || 'this link'}”?`}
        confirmLabel="Delete link"
        tone="danger"
        onConfirm={() => { if (removing) removeLink(removing) }}
        onCancel={() => setRemoving(null)}
      >
        The link is removed from your saved draft. Publish the draft to update your public page.
      </ConfirmDialog>
    </div>
  )
}
