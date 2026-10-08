import { useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { CheckboxField, Field, SelectField, TextareaField } from '../../components/Field'
import { Dialog } from '../../components/Dialog'
import { Icon } from '../../components/Icon'
import { errorMessageFor } from '../../lib/api'
import { fetchPageLinkMetadata } from '../pages/api'
import type { EditorGroup } from './context'

// ============================================================================
// The Add Link modal.
//
// Mirrors the wireframe: a URL field that can auto-fetch the destination's title
// and description, a title and description with live counters, a group picker,
// and an "open in a new tab" switch. The counters are the API's real caps
// (140 / 280), not the mockup's smaller numbers — a form that lets you type
// something the server will reject is a form that lies.
//
// Adding is local: the new link joins the working draft, and the draft's
// autosave eventually persists it. So this dialog never blocks on the network,
// and a failed fetch is a suggestion that did not arrive rather than a dead end.
// ============================================================================

export interface NewLinkInput {
  title: string
  url: string
  description: string
  groupId: string | null
  openInNewTab: boolean
  isVisible: boolean
  icon: string | null
  thumbnailKey: string | null
  startsAt: number | null
  endsAt: number | null
}

export interface AddLinkDialogProps {
  open: boolean
  onClose: () => void
  pageId: string
  groups: EditorGroup[]
  onSubmit: (input: NewLinkInput) => void
}

const TITLE_MAX = 140
const DESCRIPTION_MAX = 280

export function AddLinkDialog({ open, onClose, pageId, groups, onSubmit }: AddLinkDialogProps) {
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [groupId, setGroupId] = useState('')
  const [openInNewTab, setOpenInNewTab] = useState(true)
  const [visible, setVisible] = useState(true)

  const [fetching, setFetching] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [titleTouched, setTitleTouched] = useState(false)
  const [descriptionTouched, setDescriptionTouched] = useState(false)

  useEffect(() => {
    if (!open) return
    setUrl('')
    setTitle('')
    setDescription('')
    setGroupId('')
    setOpenInNewTab(true)
    setVisible(true)
    setFetching(false)
    setFetched(false)
    setFetchError(null)
    setTitleTouched(false)
    setDescriptionTouched(false)
  }, [open])

  const canFetch = url.trim() !== '' && !fetching
  const canAdd = url.trim() !== '' && title.trim() !== '' && !fetching

  const runFetch = async () => {
    const value = url.trim()
    if (!value) return
    setFetching(true)
    setFetchError(null)
    setFetched(false)
    try {
      const meta = await fetchPageLinkMetadata(pageId, value)
      if (meta.title && !titleTouched) setTitle(meta.title.slice(0, TITLE_MAX))
      if (meta.description && !descriptionTouched) setDescription(meta.description.slice(0, DESCRIPTION_MAX))
      setFetched(true)
    } catch (cause: unknown) {
      setFetchError(errorMessageFor(cause))
    } finally {
      setFetching(false)
    }
  }

  const submit = () => {
    if (!canAdd) return
    onSubmit({
      title: title.trim(),
      url: url.trim(),
      description: description.trim(),
      groupId: groupId === '' ? null : groupId,
      openInNewTab,
      isVisible: visible,
      icon: null,
      thumbnailKey: null,
      startsAt: null,
      endsAt: null,
    })
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add Link"
      icon="links"
      description="Paste a destination and OneLink can fill in its title, description, and favicon."
      footer={
        <>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="button" size="sm" disabled={!canAdd} onClick={submit}>
            <Icon name="check" size={16} /> Add Link
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <Field
            label="URL"
            type="url"
            inputMode="url"
            autoFocus
            required
            value={url}
            disabled={fetching}
            placeholder="https://example.com"
            hint="A full address starting with https:// or http://."
            onChange={(event) => { setUrl(event.currentTarget.value); setFetched(false); setFetchError(null) }}
            onBlur={() => { if (url.trim()) void runFetch() }}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" size="sm" pending={fetching} pendingLabel="Fetching" disabled={!canFetch} onClick={() => void runFetch()}>
              <Icon name="sparkles" size={15} /> Auto-fetch metadata
            </Button>
            {fetched ? (
              <span role="status" className="inline-flex items-center gap-1.5 font-mono text-[0.6875rem] text-ink-soft">
                <Icon name="check" size={14} /> Title, description and favicon fetched
              </span>
            ) : null}
          </div>
          {fetchError ? <p role="status" className="mt-2 text-xs text-ink-soft">{fetchError}</p> : null}
        </div>

        <Field
          label="Title"
          value={title}
          maxLength={TITLE_MAX}
          required
          hint={`${title.length}/${TITLE_MAX} characters.`}
          onChange={(event) => { setTitle(event.currentTarget.value); setTitleTouched(true) }}
        />

        <TextareaField
          label="Description (optional)"
          rows={3}
          value={description}
          maxLength={DESCRIPTION_MAX}
          hint={`${description.length}/${DESCRIPTION_MAX} characters.`}
          onChange={(event) => { setDescription(event.currentTarget.value); setDescriptionTouched(true) }}
        />

        {groups.length > 0 ? (
          <SelectField
            label="Group"
            value={groupId}
            options={[{ value: '', label: 'No group' }, ...groups.map((group) => ({ value: group.key, label: group.name }))]}
            onChange={(event) => setGroupId(event.currentTarget.value)}
          />
        ) : null}

        <CheckboxField
          label='Open in a new tab (target="_blank")'
          checked={openInNewTab}
          onChange={(event) => setOpenInNewTab(event.currentTarget.checked)}
        />
        <CheckboxField
          label="Show on my page"
          checked={visible}
          hint="A hidden link stays in the list but is left out of your published page."
          onChange={(event) => setVisible(event.currentTarget.checked)}
        />
      </div>
    </Dialog>
  )
}