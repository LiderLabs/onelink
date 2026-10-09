import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, ArrowUpRight, CheckCircle, ClockCounterClockwise, Eye, EyeSlash, FloppyDisk, Info, LinkSimple, Palette, PencilSimple, Plus, RocketLaunch, Trash, UserCircle, X } from '@phosphor-icons/react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Field, SelectField, TextareaField } from '../../components/Field'
import { Notice } from '../../components/Notice'
import { Splash } from '../../components/StatusScreens'
import { ApiError, errorMessageFor, fieldErrorsFrom } from '../../lib/api'
import { useUnsavedChanges } from '../../lib/dirty-form'
import { useSession } from '../../lib/session'
import type { LinkGroup, OwnerPageDetail, PageDraftContent, PageDraftState, PageLink, PageLinkInput, PageRevision, PublicPageDto, PublicPageOwner, UpdatePageInput } from '../../lib/types'
import { CreatorPreview, draftModel } from '../creator/CreatorPreview'
import { ProfilePhotoEditor } from '../profile/ProfilePhotoEditor'
import { SocialsEditor } from '../profile/SocialsEditor'
import type { PreviewPhoto, PreviewSocials } from '../profile/ProfilePreview'
import '../profile/profile.css'
import '../creator/creator-editor.css'
import { deleteMediaAsset, uploadPageImage } from '../media/api'
import type { MediaAsset } from '../media/types'
import { QrCodeTools } from './QrCodeTools'
import { checkSlugAvailability, deletePage, discardPageDraft, fetchPageLinkMetadata, getPage, getPageDraft, getPagePreview, getPageRevision, listPageLinks, listPageRevisions, publicPagePath, publishPage, restorePageRevision, savePageDraft, slugReasonMessage, unpublishPage, updatePage } from './api'
import { PageRenderer } from './PageRenderer'
import { PublishedPageLink } from './PublishedPageLink'

interface PageValues {
  title: string
  bio: string
  theme: 'light' | 'dark'
  layout: 'list' | 'grid'
  accentColor: string
  showBranding: boolean
}

interface LinkValues {
  title: string
  url: string
  description: string
  isVisible: boolean
  groupId: string
  openInNewTab: boolean
  thumbnailKey: string
  startsAt: string
  endsAt: string
}

const EMPTY_LINK: LinkValues = { title: '', url: '', description: '', isVisible: true, groupId: '', openInNewTab: false, thumbnailKey: '', startsAt: '', endsAt: '' }

function localDateTime(epoch: number | null): string {
  if (epoch === null) return ''
  const date = new Date(epoch)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function epochFromLocal(value: string): number | null {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

const ULID_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/

function draftContentFor(
  detail: OwnerPageDetail,
  page: PageValues,
  groups: LinkGroup[],
): PageDraftContent {
  const groupIds = new Set(groups.filter((group) => ULID_ID.test(group.id)).map((group) => group.id))
  return {
    v: 1,
    page: {
      title: page.title.trim() || null,
      bio: page.bio.trim() || null,
      theme: page.theme,
      layout: page.layout,
      accentColor: page.accentColor.trim() || null,
      showBranding: page.showBranding,
    },
    groups: groups.map((group) => ({
      ...(ULID_ID.test(group.id) ? { id: group.id } : {}),
      name: group.name,
    })),
    links: detail.links.map((link) => ({
      ...(ULID_ID.test(link.id) ? { id: link.id } : {}),
      title: link.title,
      url: link.url,
      description: link.description,
      icon: link.icon,
      isVisible: link.isVisible,
      groupId: link.groupId && groupIds.has(link.groupId) ? link.groupId : null,
      openInNewTab: link.openInNewTab,
      thumbnailKey: link.thumbnailKey,
      startsAt: link.startsAt,
      endsAt: link.endsAt,
    })),
  }
}

function linkFromDraft(
  link: PageDraftContent['links'][number],
  position: number,
  status: PageLink['status'] = 'active',
): PageLink {
  const now = Date.now()
  return {
    id: link.id ?? `pending-${position}-${link.url}`,
    title: link.title,
    url: link.url,
    domain: (() => { try { return new URL(link.url).hostname } catch { return null } })(),
    description: link.description,
    icon: link.icon,
    position,
    isVisible: link.isVisible,
    startsAt: link.startsAt,
    endsAt: link.endsAt,
    groupId: link.groupId,
    openInNewTab: link.openInNewTab,
    thumbnailKey: link.thumbnailKey,
    status,
    createdAt: 0,
    updatedAt: now,
  }
}

function valuesForLink(link: PageLink): LinkValues {
  return {
    title: link.title,
    url: link.url,
    description: link.description ?? '',
    isVisible: link.isVisible,
    groupId: link.groupId ?? '',
    openInNewTab: link.openInNewTab,
    thumbnailKey: link.thumbnailKey ?? '',
    startsAt: localDateTime(link.startsAt),
    endsAt: localDateTime(link.endsAt),
  }
}

export function PageEditorRoute() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const session = useSession()
  const [tab, setTab] = useState<'profile' | 'links' | 'design' | 'publish'>('profile')
  const [actionHost, setActionHost] = useState<HTMLElement | null>(null)
  const [previewOwner, setPreviewOwner] = useState<PublicPageOwner | null>(null)
  const [photo, setPhoto] = useState<PreviewPhoto | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [socialPreview, setSocialPreview] = useState<PreviewSocials>({ links: [], loading: true, unavailable: false })
  const [socialState, setSocialState] = useState({ pending: false, dirty: false })
  const [, refreshClock] = useState(0)
  useEffect(() => {
    setActionHost(document.getElementById('creator-page-actions'))
    const timer = window.setInterval(() => refreshClock(value => value + 1), 15000)
    return () => clearInterval(timer)
  }, [id])
  const shortcutHandled = useRef<string | null>(null)
  const [detail, setDetail] = useState<OwnerPageDetail | null>(null)
  const [liveLinks, setLiveLinks] = useState<PageLink[]>([])
  const [draft, setDraft] = useState<PageDraftState | null>(null)
  const [draftReady, setDraftReady] = useState(false)
  const [draftStatus, setDraftStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [draftError, setDraftError] = useState<unknown>(null)
  const [draftConflict, setDraftConflict] = useState<PageDraftState | null>(null)
  const [draftRetry, setDraftRetry] = useState(0)
  const [revisions, setRevisions] = useState<PageRevision[]>([])
  const [revisionError, setRevisionError] = useState<unknown>(null)
  const [revisionDetail, setRevisionDetail] = useState<{ meta: PageRevision; content: PageDraftContent } | null>(null)
  const [revisionsOpen, setRevisionsOpen] = useState(false)
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null)
  const [draftActionPending, setDraftActionPending] = useState(false)
  const [discardDraftOpen, setDiscardDraftOpen] = useState(false)
  const [publishSavedDraftOpen, setPublishSavedDraftOpen] = useState(false)
  const [serverPreview, setServerPreview] = useState<PublicPageDto | null>(null)
  const [previewPending, setPreviewPending] = useState(false)
  const [previewError, setPreviewError] = useState<unknown>(null)
  const draftUpdatedAt = useRef<number | null>(null)
  const draftSaving = useRef(false)
  const draftQueued = useRef(false)
  const metadataRequest = useRef(0)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [retry, setRetry] = useState(0)
  const [pageValues, setPageValues] = useState<PageValues | null>(null)
  const [slugValue, setSlugValue] = useState('')
  const [checkedSlug, setCheckedSlug] = useState('')
  const [availableSlug, setAvailableSlug] = useState('')
  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'available' | 'unavailable' | 'error'>('idle')
  const [slugMessage, setSlugMessage] = useState<string | null>(null)
  const [renameConfirmOpen, setRenameConfirmOpen] = useState(false)
  const [pagePending, setPagePending] = useState(false)
  const [pageError, setPageError] = useState<unknown>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const linkDialogRef = useRef<HTMLDialogElement>(null)
  const [editingLink, setEditingLink] = useState<PageLink | null>(null)
  const [linkValues, setLinkValues] = useState<LinkValues>(EMPTY_LINK)
  const [linkBaseline, setLinkBaseline] = useState<LinkValues>(EMPTY_LINK)
  const [linkError, setLinkError] = useState<unknown>(null)
  const [discardLinkOpen, setDiscardLinkOpen] = useState(false)
  const [actionError, setActionError] = useState<unknown>(null)
  const [actionPending, setActionPending] = useState<'publish' | 'unpublish' | null>(null)
  const [deletingLink, setDeletingLink] = useState<PageLink | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [deletingPage, setDeletingPage] = useState(false)
  const [deletePending, setDeletePending] = useState(false)
  const [deleteError, setDeleteError] = useState<unknown>(null)
  const [shareMessage, setShareMessage] = useState<string | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)
  const [qrOpen, setQrOpen] = useState(false)
  const [groups, setGroups] = useState<LinkGroup[]>([])
  const [trashLinks, setTrashLinks] = useState<PageLink[]>([])
  const [selectedLinkIds, setSelectedLinkIds] = useState<string[]>([])
  const [groupName, setGroupName] = useState('')
  const [editingGroup, setEditingGroup] = useState<LinkGroup | null>(null)
  const [deletingGroup, setDeletingGroup] = useState<LinkGroup | null>(null)
  const [listTrash, setListTrash] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState('all')
  const [hiddenLinksOpen, setHiddenLinksOpen] = useState(true)
  const [uploadedImage, setUploadedImage] = useState<MediaAsset | null>(null)
  const [imagePending, setImagePending] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [metadataPending, setMetadataPending] = useState(false)
  const [metadataSuggestion, setMetadataSuggestion] = useState<{ url: string; title: string | null; description: string | null } | null>(null)

  useEffect(() => {
    if (!draftReady || shortcutHandled.current === location.key) return
    shortcutHandled.current = location.key
    const query = new URLSearchParams(location.search)
    const section = query.get('tab')
    setTab(section === 'links' ? 'links' : section === 'publish' || query.get('qr') === '1' || location.hash === '#publish-heading' ? 'publish' : section === 'design' || location.hash === '#appearance-heading' ? 'design' : 'profile')
    if (query.get('qr') === '1') setQrOpen(true)
    if (query.get('add') === '1') {
      setEditingLink(null); setLinkValues(EMPTY_LINK); setLinkBaseline(EMPTY_LINK); setLinkError(null); setLinkOpen(true)
    }
    const heading = query.get('tab') === 'links' ? 'links-heading' : query.get('tab') === 'publish' ? 'publish-heading' : location.hash.slice(1)
    if (heading) window.requestAnimationFrame(() => document.getElementById(heading)?.scrollIntoView({ block: 'start' }))
  }, [draftReady, location.key, location.search, location.hash])

  useEffect(() => {
    const dialog = linkDialogRef.current
    if (!dialog) return
    if (linkOpen && !dialog.open) {
      dialog.showModal()
      dialog.querySelector<HTMLInputElement>('input:not([type="file"])')?.focus()
    } else if (!linkOpen && dialog.open) {
      dialog.close()
    }
  }, [linkOpen])

  useEffect(() => {
    let current = true
    setDetail(null)
    setPreviewOwner(null); setPhoto(null); setPhotoBusy(false); setSocialState({ pending: false, dirty: false })
    setLoadError(null)
    setPageValues(null)
    setDraft(null)
    setDraftReady(false)
    setDraftStatus('saved')
    setDraftError(null)
    void Promise.all([getPage(id), listPageLinks(id, true), getPageDraft(id)]).then(([result, trashResult, draftResult]) => {
      if (!current) return
      setLiveLinks(result.links)
      const liveStatus = new Map(result.links.map((link) => [link.id, link.status]))
      const draftLinks = draftResult.draft.content.links.map((link, position) =>
        linkFromDraft(link, position, liveStatus.get(link.id ?? '') ?? 'active'),
      )
      setDetail({ ...result, links: draftLinks })
      setDraft(draftResult.draft)
      draftUpdatedAt.current = draftResult.draft.updatedAt
      const draftGroups = draftResult.draft.content.groups.map((group, position) => ({
        id: group.id ?? `pending-group-${position}`,
        name: group.name,
        position,
      }))
      setGroups(draftGroups)
      setTrashLinks(trashResult.links)
      setPageValues({
        title: draftResult.draft.content.page.title ?? '',
        bio: draftResult.draft.content.page.bio ?? '',
        theme: draftResult.draft.content.page.theme,
        layout: draftResult.draft.content.page.layout,
        accentColor: draftResult.draft.content.page.accentColor ?? '',
        showBranding: draftResult.draft.content.page.showBranding,
      })
      setSlugValue(result.page.slug)
      setDraftReady(true)
      setSlugStatus('idle')
      document.title = `${result.page.title?.trim() || result.page.slug} · Edit page`
    }).catch((cause: unknown) => {
      if (current) setLoadError(cause)
    })
    return () => { current = false }
  }, [id, retry])

  useEffect(() => {
    if (!detail || slugValue.trim().toLowerCase() === detail.page.slug.toLowerCase()) {
      setSlugStatus('idle')
      setSlugMessage(null)
      setCheckedSlug('')
      setAvailableSlug('')
      return
    }
    let current = true
    setSlugStatus('checking')
    setSlugMessage(null)
    setCheckedSlug('')
    const timer = window.setTimeout(() => {
      void checkSlugAvailability(slugValue).then((result) => {
        if (!current) return
        setCheckedSlug(slugValue.trim())
        setAvailableSlug(result.slug)
        setSlugStatus(result.available ? 'available' : 'unavailable')
        setSlugMessage(slugReasonMessage(result.reason))
      }).catch((cause: unknown) => {
        if (!current) return
        setSlugStatus('error')
        setSlugMessage(errorMessageFor(cause))
      })
    }, 350)
    return () => { current = false; window.clearTimeout(timer) }
  }, [detail, slugValue])

  useEffect(() => {
    if (!draftReady || !detail || !pageValues || !draft) return
    const content = draftContentFor(detail, pageValues, groups)
    if (JSON.stringify(content) === JSON.stringify(draft.content)) {
      setDraftStatus('saved')
      return
    }
    const localLinkIds = detail.links.map((link) => link.id)
    const localGroupIds = groups.map((group) => group.id)
    const timer = window.setTimeout(() => {
      if (draftSaving.current) {
        draftQueued.current = true
        return
      }
      draftSaving.current = true
      setDraftStatus('saving')
      setDraftError(null)
      void savePageDraft(id, content, draftUpdatedAt.current).then(({ draft: saved }) => {
        draftUpdatedAt.current = saved.updatedAt
        setDraftConflict(null)
        setDraft(saved)
        setDraftStatus('saved')
        setServerPreview(null)
        const savedLinkIds = saved.content.links.map((link) => link.id)
        const savedGroupIds = saved.content.groups.map((group) => group.id)
        const linkIdMap = new Map<string, string>()
        localLinkIds.forEach((localId, index) => {
          const savedId = savedLinkIds[index]
          if (savedId && !ULID_ID.test(localId)) linkIdMap.set(localId, savedId)
        })
        const groupIdMap = new Map<string, string>()
        localGroupIds.forEach((localId, index) => {
          const savedId = savedGroupIds[index]
          if (savedId && !ULID_ID.test(localId)) groupIdMap.set(localId, savedId)
        })
        if (linkIdMap.size || groupIdMap.size) {
          setDetail((current) => current ? {
            ...current,
            links: current.links.map((link) => ({
              ...link,
              id: linkIdMap.get(link.id) ?? link.id,
              groupId: link.groupId ? groupIdMap.get(link.groupId) ?? link.groupId : null,
            })),
          } : current)
        }
        if (groupIdMap.size) {
          setGroups((current) => current.map((group) => ({
            ...group,
            id: groupIdMap.get(group.id) ?? group.id,
          })))
        }
      }).catch((cause: unknown) => {
        setDraftError(cause)
        setDraftStatus('error')
        if (cause instanceof ApiError && ['CONFLICT', 'PRECONDITION_FAILED'].includes(cause.code)) {
          void getPageDraft(id).then(({ draft: latest }) => {
            setDraftConflict(latest)
          }).catch((reloadError: unknown) => {
            setDraftError(reloadError)
          })
        }
      }).finally(() => {
        draftSaving.current = false
        if (draftQueued.current) {
          draftQueued.current = false
          setDraftRetry((value) => value + 1)
        }
      })
    }, 700)
    return () => window.clearTimeout(timer)
  }, [id, draftReady, detail, pageValues, groups, draft, draftRetry])

  const pageDirty = detail !== null && pageValues !== null && draft !== null &&
    (JSON.stringify(draftContentFor(detail, pageValues, groups).page) !== JSON.stringify(draft.content.page) ||
      slugValue.trim().toLowerCase() !== detail.page.slug.toLowerCase())
  const draftDirty = detail !== null && pageValues !== null && draft !== null &&
    JSON.stringify(draftContentFor(detail, pageValues, groups)) !== JSON.stringify(draft.content)
  const linkDirty = linkOpen && JSON.stringify(linkValues) !== JSON.stringify(linkBaseline)
  const accountUnsaved = photo !== null || photoBusy || socialState.dirty || socialState.pending
  const groupDirty = groupName.trim().length > 0
  const navigation = useUnsavedChanges(Boolean(pageDirty || draftDirty || linkDirty || groupDirty || draftStatus === 'error' || accountUnsaved))

  useEffect(() => {
    if (!draftReady || !draft || !detail || draftDirty || draftStatus !== 'saved') return
    let current = true
    setPreviewPending(true)
    setPreviewError(null)
    void getPagePreview(id).then(({ page }) => {
      if (current) { setServerPreview(page); setPreviewOwner(page.owner) }
    }).catch((cause: unknown) => {
      if (current) setPreviewError(cause)
    }).finally(() => {
      if (current) setPreviewPending(false)
    })
    return () => { current = false }
  }, [id, draftReady, draft, draftDirty, draftStatus, detail?.page.slug])

  const updatePageValue = <K extends keyof PageValues>(key: K, value: PageValues[K]) =>
    setPageValues((current) => current ? { ...current, [key]: value } : current)
  const updateLinkValue = <K extends keyof LinkValues>(key: K, value: LinkValues[K]) => {
    if (key === 'url') {
      metadataRequest.current += 1
      setMetadataSuggestion(null)
    }
    setLinkValues((current) => ({ ...current, [key]: value }))
  }
  const statusLabelFor = (link: PageLink) => {
    const live = liveLinks.find((candidate) => candidate.id === link.id)
    if (!live) return 'draft'
    if (live.startsAt !== link.startsAt || live.endsAt !== link.endsAt) return 'draft schedule'
    return live.status
  }

  const adoptDraft = (state: PageDraftState, sourceLinks: PageLink[] = liveLinks) => {
    setServerPreview(null)
    draftUpdatedAt.current = state.updatedAt
    setDraft(state)
    setPageValues({
      title: state.content.page.title ?? '',
      bio: state.content.page.bio ?? '',
      theme: state.content.page.theme,
      layout: state.content.page.layout,
      accentColor: state.content.page.accentColor ?? '',
      showBranding: state.content.page.showBranding,
    })
    setGroups(state.content.groups.map((group, position) => ({
      id: group.id ?? `pending-group-${position}`,
      name: group.name,
      position,
    })))
    setDetail((current) => current ? {
      ...current,
      links: state.content.links.map((link, position) => linkFromDraft(
        link,
        position,
        sourceLinks.find((item) => item.id === link.id)?.status ?? 'active',
      )),
    } : current)
    setDraftStatus('saved')
    setDraftError(null)
  }

  const refreshDetail = async () => {
    const [result, draftResult, trashResult] = await Promise.all([
      getPage(id),
      getPageDraft(id),
      listPageLinks(id, true),
    ])
    setDetail(result)
    setLiveLinks(result.links)
    adoptDraft(draftResult.draft, result.links)
    setTrashLinks(trashResult.links)
  }

  const commitPageSave = async () => {
    if (!detail) return
    const input: UpdatePageInput = {}
    const nextSlug = availableSlug || slugValue.trim().toLowerCase()
    if (nextSlug !== detail.page.slug) input.slug = nextSlug
    if (!input.slug) return
    setPagePending(true)
    setPageError(null)
    try {
      const updated = await updatePage(id, input)
      setDetail((current) => current ? { ...current, page: updated } : current)
      setSlugValue(updated.slug)
      setServerPreview(null)
      setRenameConfirmOpen(false)
    } catch (cause) {
      setPageError(cause)
    } finally {
      setPagePending(false)
    }
  }

  const savePage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!detail || !pageValues) return
    if (slugValue.trim().toLowerCase() !== detail.page.slug.toLowerCase()) {
      if (slugStatus === 'checking' || slugStatus === 'idle') {
        setPageError(new ApiError(0, 'NETWORK', 'Wait for the address availability check to finish.'))
        return
      }
      if (slugStatus !== 'available' || checkedSlug !== slugValue.trim()) {
        setPageError(new ApiError(409, 'CONFLICT', slugMessage ?? 'Choose an available address.'))
        return
      }
      setRenameConfirmOpen(true)
      return
    }
    setPageError(null)
  }

  const startNewLink = () => {
    metadataRequest.current += 1
    setMetadataSuggestion(null)
    setEditingLink(null)
    setLinkError(null)
    setLinkBaseline(EMPTY_LINK)
    setLinkValues(EMPTY_LINK)
    setLinkOpen(true)
  }

  const startEditLink = (link: PageLink) => {
    metadataRequest.current += 1
    setMetadataSuggestion(null)
    const values = valuesForLink(link)
    setEditingLink(link)
    setLinkError(null)
    setLinkBaseline(values)
    setLinkValues(values)
    setLinkOpen(true)
  }

  const closeLinkForm = () => {
    if (linkDirty) {
      setDiscardLinkOpen(true)
      return
    }
    setLinkOpen(false)
    setEditingLink(null)
    setLinkError(null)
  }

  const discardLinkForm = () => {
    setDiscardLinkOpen(false)
    void cancelUploadedImage()
    setLinkOpen(false)
    setEditingLink(null)
    setLinkError(null)
  }

  const saveLink = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!detail) return
    const startChanged = !editingLink || linkValues.startsAt !== linkBaseline.startsAt
    const endChanged = !editingLink || linkValues.endsAt !== linkBaseline.endsAt
    const start = startChanged ? epochFromLocal(linkValues.startsAt) : editingLink?.startsAt ?? null
    const end = endChanged ? epochFromLocal(linkValues.endsAt) : editingLink?.endsAt ?? null
    if (start !== null && end !== null && start >= end) {
      setLinkError(new ApiError(400, 'BAD_REQUEST', 'The end time must be after the start time.'))
      return
    }
    const input: PageLinkInput = {
      title: linkValues.title,
      url: linkValues.url,
      description: linkValues.description.trim() || null,
      isVisible: linkValues.isVisible,
      groupId: linkValues.groupId || null,
      openInNewTab: linkValues.openInNewTab,
      thumbnailKey: linkValues.thumbnailKey || null,
      ...(startChanged ? { startsAt: start } : {}),
      ...(endChanged ? { endsAt: end } : {}),
    }
    const previous = editingLink
    const next: PageLink = {
      ...(previous ?? linkFromDraft({
        title: input.title,
        url: input.url,
        description: input.description ?? null,
        icon: input.icon ?? null,
        isVisible: input.isVisible ?? true,
        groupId: input.groupId ?? null,
        openInNewTab: input.openInNewTab ?? false,
        thumbnailKey: input.thumbnailKey ?? null,
        startsAt: start,
        endsAt: end,
      }, detail.links.length)),
      id: previous?.id ?? `pending-link-${crypto.randomUUID()}`,
      title: input.title,
      url: input.url,
      domain: (() => { try { return new URL(input.url).hostname } catch { return null } })(),
      description: input.description ?? null,
      isVisible: input.isVisible ?? true,
      groupId: input.groupId ?? null,
      openInNewTab: input.openInNewTab ?? false,
      thumbnailKey: input.thumbnailKey ?? null,
      startsAt: start,
      endsAt: end,
      position: previous?.position ?? detail.links.length,
      updatedAt: Date.now(),
    }
    setDetail((current) => current ? {
      ...current,
      links: previous
        ? current.links.map((link) => link.id === previous.id ? next : link)
        : [...current.links, next],
    } : current)
    setUploadedImage(null)
    setLinkOpen(false)
    setEditingLink(null)
    setLinkError(null)
  }

  const removeLink = async () => {
    if (!deletingLink) return
    setDetail((current) => current ? {
      ...current,
      links: current.links.filter((link) => link.id !== deletingLink.id),
    } : current)
    setSelectedLinkIds((current) => current.filter((linkId) => linkId !== deletingLink?.id))
    setDeletingLink(null)
  }

  const addGroup = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = groupName.trim()
    if (!name) return
    if (editingGroup) {
      setGroups((current) => current.map((group) => group.id === editingGroup.id ? { ...group, name } : group))
      setEditingGroup(null)
    } else {
      setGroups((current) => [...current, { id: `pending-group-${crypto.randomUUID()}`, name, position: groups.length }])
    }
    setGroupName('')
  }

  const moveGroup = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= groups.length) return
    const reordered = [...groups]
    const [moved] = reordered.splice(index, 1)
    if (!moved) return
    reordered.splice(target, 0, moved)
    setGroups(reordered.map((group, position) => ({ ...group, position })))
  }

  const confirmRemoveGroup = () => {
    if (!deletingGroup) return
    const groupId = deletingGroup.id
    setGroups((current) => current.filter((group) => group.id !== groupId))
    setDetail((current) => current ? {
      ...current,
      links: current.links.map((link) => link.groupId === groupId ? { ...link, groupId: null } : link),
    } : current)
    setDeletingGroup(null)
  }

  const runBulkAction = (action: 'hide' | 'show' | 'move', groupId?: string | null) => {
    if (selectedLinkIds.length === 0) return
    setDetail((current) => current ? {
      ...current,
      links: current.links.map((link) => {
        if (!selectedLinkIds.includes(link.id)) return link
        if (action === 'hide') return { ...link, isVisible: false }
        if (action === 'show') return { ...link, isVisible: true }
        return { ...link, groupId: groupId ?? null }
      }),
    } : current)
    setSelectedLinkIds([])
  }

  const confirmBulkRemove = () => {
    if (selectedLinkIds.length === 0) return
    const selected = new Set(selectedLinkIds)
    setDetail((current) => current ? {
      ...current,
      links: current.links.filter((link) => !selected.has(link.id)),
    } : current)
    setSelectedLinkIds([])
    setBulkDeleteOpen(false)
  }

  const restoreLink = (link: PageLink) => {
    const restored = { ...link, position: detail?.links.length ?? 0, updatedAt: Date.now() }
    setDetail((current) => current ? { ...current, links: [...current.links, restored] } : current)
    setTrashLinks((current) => current.filter((item) => item.id !== link.id))
  }

  const uploadThumbnail = async (file: File | undefined) => {
    if (!file) return
    setImagePending(true)
    setImageError(null)
    try {
      const media = await uploadPageImage(file, {})
      setUploadedImage(media)
      updateLinkValue('thumbnailKey', media.key)
    } catch (cause) {
      setImageError(errorMessageFor(cause))
    } finally {
      setImagePending(false)
    }
  }

  const suggestLinkDetails = async () => {
    if (!detail || !linkValues.url.trim()) return
    const requestId = ++metadataRequest.current
    setMetadataPending(true)
    setLinkError(null)
    try {
      const result = await fetchPageLinkMetadata(id, linkValues.url.trim())
      if (metadataRequest.current === requestId) setMetadataSuggestion(result)
    } catch (cause) {
      if (metadataRequest.current === requestId) setLinkError(cause)
    } finally {
      setMetadataPending(false)
    }
  }

  const cancelUploadedImage = async () => {
    if (!uploadedImage || uploadedImage.key !== linkValues.thumbnailKey) return
    try {
      await deleteMediaAsset(uploadedImage.id)
      setUploadedImage(null)
    } catch (cause) {
      setImageError(errorMessageFor(cause))
    }
  }

  const moveLink = async (index: number, direction: -1 | 1) => {
    if (!detail) return
    const target = index + direction
    if (target < 0 || target >= detail.links.length) return
    const reordered = [...detail.links]
    const [moved] = reordered.splice(index, 1)
    if (!moved) return
    reordered.splice(target, 0, moved)
    setDetail((current) => current ? {
      ...current,
      links: reordered.map((link, position) => ({ ...link, position })),
    } : current)
  }

  const changePublication = async (action: 'publish' | 'unpublish', publishLastSaved = false) => {
    if (!detail || linkDirty || groupDirty || accountUnsaved || slugValue.trim().toLowerCase() !== detail.page.slug.toLowerCase()) return
    if (action === 'publish' && draftDirty && draftStatus === 'error' && !publishLastSaved) {
      setPublishSavedDraftOpen(true)
      return
    }
    if (!publishLastSaved && (draftDirty || draftStatus !== 'saved' || draftError)) return
    setActionPending(action)
    setActionError(null)
    try {
      if (action === 'publish') await publishPage(id)
      else await unpublishPage(id)
      setPublishSavedDraftOpen(false)
      await refreshDetail()
    } catch (cause) {
      setActionError(cause)
    } finally {
      setActionPending(null)
    }
  }

  const discardDraft = async () => {
    if (draftDirty || draftStatus !== 'saved') return
    setDraftActionPending(true)
    setDraftError(null)
    try {
      const result = await discardPageDraft(id)
      adoptDraft(result.draft)
      setLinkOpen(false)
      setEditingLink(null)
      setDiscardDraftOpen(false)
    } catch (cause) {
      setDraftError(cause)
    } finally {
      setDraftActionPending(false)
    }
  }

  const overwriteConflictingDraft = () => {
    if (!draftConflict) return
    draftUpdatedAt.current = draftConflict.updatedAt
    setDraft(draftConflict)
    setDraftConflict(null)
    setDraftError(null)
    setDraftStatus('saved')
    setDraftRetry((value) => value + 1)
  }

  const useConflictingDraft = () => {
    if (!draftConflict) return
    adoptDraft(draftConflict)
    setDraftConflict(null)
  }

  const openRevisionHistory = async () => {
    setRevisionsOpen(true)
    setRevisionError(null)
    try {
      const result = await listPageRevisions(id)
      setRevisions(result.revisions)
    } catch (cause) {
      setRevisionError(cause)
    }
  }

  const inspectRevision = async (revision: number) => {
    setRevisionError(null)
    try {
      const result = await getPageRevision(id, revision)
      const meta = revisions.find((item) => item.revision === revision)
      if (!meta) return
      setRevisionDetail({ meta, content: result.content })
    } catch (cause) {
      setRevisionError(cause)
    }
  }

  const restoreRevision = async () => {
    if (selectedRevision === null) return
    setDraftActionPending(true)
    setRevisionError(null)
    try {
      const result = await restorePageRevision(id, selectedRevision)
      adoptDraft(result.draft)
      setRevisionsOpen(false)
      setSelectedRevision(null)
    } catch (cause) {
      setRevisionError(cause)
    } finally {
      setDraftActionPending(false)
    }
  }

  const loadServerPreview = async () => {
    setPreviewPending(true)
    setPreviewError(null)
    try {
      const result = await getPagePreview(id)
      setServerPreview(result.page)
      setPreviewOwner(result.page.owner)
    } catch (cause) {
      setPreviewError(cause)
    } finally {
      setPreviewPending(false)
    }
  }

  const sharePublicPage = async () => {
    if (!detail) return
    const url = new URL(publicPagePath(detail.page.slug), window.location.origin).href
    if (!navigator.share) {
      await copyPublicLink()
      return
    }
    try {
      await navigator.share({ title: pageValues?.title.trim() || detail.page.slug, url })
      setShareMessage('Page shared.')
      setShareError(null)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setShareError('Sharing could not be completed. You can still copy the public link.')
    }
  }

  const removePage = async () => {
    if (!detail) return
    setDeletePending(true)
    setDeleteError(null)
    try {
      await deletePage(id)
      navigate('/app/pages', { replace: true })
    } catch (cause) {
      setDeleteError(cause)
      setDeletePending(false)
    }
  }

  const copyPublicLink = async () => {
    if (!detail) return
    setShareMessage(null)
    setShareError(null)
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.')
      await navigator.clipboard.writeText(new URL(publicPagePath(detail.page.slug), window.location.origin).href)
      setShareMessage('Public link copied.')
    } catch {
      setShareError('Could not copy the public link. Open the live page and copy its address.')
    }
  }

  const linkErrors = fieldErrorsFrom(linkError)
  const linkRows = detail?.links.map((link, index) => ({ link, index })) ?? []
  const groupMatches = ({ link }: { link: PageLink; index: number }) =>
    selectedGroup === 'all' || (selectedGroup === '__ungrouped__' ? link.groupId === null : link.groupId === selectedGroup)
  const visibleRows = linkRows.filter((row) => row.link.isVisible && groupMatches(row))
  const hiddenRows = linkRows.filter((row) => !row.link.isVisible && groupMatches(row))
  const toggleVisibility = (linkId: string) => {
    setDetail((current) => current ? {
      ...current,
      links: current.links.map((link) => link.id === linkId ? { ...link, isVisible: !link.isVisible } : link),
    } : current)
  }
  const renderLinkRows = (rows: typeof linkRows) => rows.map(({ link, index }) => (
    <li key={link.id} className="creator-editor-link-row grid grid-cols-[auto_minmax(0,1fr)] gap-3 border-b border-rule py-4 last:border-b-0">
      <div className="flex flex-col items-center gap-1">
        <button type="button" aria-label={`Move ${link.title} up`} title="Move up" disabled={index === 0 || actionPending !== null} onClick={() => void moveLink(index, -1)} className="creator-icon-button"><ArrowUp size={17} /></button>
        <button type="button" aria-label={`Move ${link.title} down`} title="Move down" disabled={index === (detail?.links.length ?? 0) - 1 || actionPending !== null} onClick={() => void moveLink(index, 1)} className="creator-icon-button"><ArrowDown size={17} /></button>
      </div>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="checkbox"
              aria-label={`Select ${link.title}`}
              checked={selectedLinkIds.includes(link.id)}
              onChange={(event) => {
                const checked = event.currentTarget.checked
                setSelectedLinkIds(current => checked ? current.includes(link.id) ? current : [...current, link.id] : current.filter(value => value !== link.id))
              }}
              className="accent-black"
            />
            <h3 className="font-medium">{link.title}</h3>
            <span className="stamp">{link.isVisible ? statusLabelFor(link) : 'hidden'}</span>
            {link.groupId ? <span className="stamp">{groups.find((group) => group.id === link.groupId)?.name ?? 'group'}</span> : null}
            {link.openInNewTab ? <span className="stamp">new tab</span> : null}
          </div>
          <p className="mt-1 truncate font-mono text-xs text-ink-soft">{link.url}</p>
          {link.description ? <p className="mt-1 text-sm text-ink-faint">{link.description}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" aria-pressed={link.isVisible} aria-label={`${link.isVisible ? 'Hide' : 'Show'} ${link.title}`} title={link.isVisible ? 'Hide link' : 'Show link'} onClick={() => toggleVisibility(link.id)} className="creator-icon-button">
            {link.isVisible ? <Eye size={18} /> : <EyeSlash size={18} />}
          </button>
          <button type="button" aria-label={`Edit ${link.title}`} title="Edit link" onClick={() => startEditLink(link)} className="creator-icon-button"><PencilSimple size={18} /></button>
          <button type="button" aria-label={`Remove ${link.title}`} title="Remove link" onClick={() => { setDeleteError(null); setDeletingLink(link) }} className="creator-icon-button creator-editor-remove"><Trash size={18} /></button>
        </div>
      </div>
    </li>
  ))

  if (detail === null) {
    if (loadError === null) return <Splash label="Opening your page" />
    if (loadError instanceof ApiError && loadError.status === 404) {
      return (
        <EmptyState title="This page is unavailable">
          It may have been removed or you may not have access. Page details are not disclosed.
          <span className="mt-3 block"><Link to="/app/pages" className="underline underline-offset-4">Return to My pages</Link></span>
        </EmptyState>
      )
    }
    return <ErrorNotice error={loadError} action="Try loading this page again" onRetry={() => setRetry((value) => value + 1)} />
  }

  if (!pageValues) return <Splash label="Preparing the editor" />
  const hasUnsaved = Boolean(pageDirty || draftDirty || linkDirty || groupDirty || accountUnsaved || draftStatus !== 'saved')
  const owner = previewOwner ?? serverPreview?.owner
  const ownsProfile = Boolean(owner && owner.username === session.user?.username)
  const accountReadable = Boolean(ownsProfile && session.user?.status === 'active' && !session.mustChangePassword)
  const accountWritable = accountReadable && session.user?.impersonatedBy === null
  const liveOwner = owner && ownsProfile && session.user ? {
    ...owner,
    displayName: session.user.displayName,
    avatarUrl: session.user.avatarUrl,
    bio: session.user.bio,
    location: session.user.location,
    pronouns: session.user.pronouns,
    socials: !socialPreview.loading && !socialPreview.unavailable
      ? socialPreview.links.filter(link => link.isVisible) : owner.socials,
  } : owner
  const livePreview = liveOwner ? draftModel(detail.page.slug, draftContentFor(detail, pageValues, groups), liveOwner) : null
  const editorActions = <>
    <span className="creator-editor-save-state" data-unsaved={hasUnsaved} role="status"><CheckCircle size={15} />{draftStatus === 'error' ? 'Save needs attention' : draftStatus === 'saving' ? 'Saving…' : hasUnsaved ? 'Unsaved changes' : 'All changes saved'}</span>
    <button type="button" className="creator-button" disabled={draftStatus === 'saving' || Boolean(draftConflict)} onClick={() => setDraftRetry(value => value + 1)}><FloppyDisk size={17} />Save draft</button>
    <button type="button" className="creator-button" onClick={() => { setTab('publish'); void openRevisionHistory() }}><ClockCounterClockwise size={17} />History</button>
    <button type="button" className="creator-button creator-button-primary" disabled={hasUnsaved || actionPending !== null || detail.page.moderationStatus !== 'visible' || (detail.page.status === 'published' && !draft?.unpublishedChanges)} onClick={() => void changePublication('publish')}><RocketLaunch size={17} />{actionPending === 'publish' ? 'Publishing…' : 'Publish'}</button>
  </>
  const publicUrl = new URL(publicPagePath(detail.page.slug), window.location.origin).href
  const revisionPreview = revisionDetail ? {
    slug: detail.page.slug,
    title: revisionDetail.content.page.title,
    bio: revisionDetail.content.page.bio,
    theme: revisionDetail.content.page.theme,
    layout: revisionDetail.content.page.layout,
    accentColor: revisionDetail.content.page.accentColor,
    showBranding: revisionDetail.content.page.showBranding,
    links: revisionDetail.content.links.map((link, position) => linkFromDraft(link, position)),
    groups: revisionDetail.content.groups.map((group, position) => ({
      id: group.id ?? `revision-group-${position}`,
      name: group.name,
      position,
    })),
  } : null

  return (
    <section className="creator-page-editor creator-legacy">
      {actionHost ? createPortal(editorActions, actionHost) : <div className="creator-page-actions">{editorActions}</div>}
      <div className="creator-editor-heading">
        <div>
          <p className="creator-eyebrow">Build your presence</p>
          <h1>Your page, your way.</h1>
          <p>Everything you need to make your OneLink page feel like you.</p>
        </div>
        <span className={`creator-badge ${draft?.unpublishedChanges || detail.page.status !== 'published' ? 'creator-badge-private' : 'creator-badge-live'}`}>{draft?.unpublishedChanges ? 'Unpublished changes' : detail.page.status === 'published' ? 'Page live' : 'Draft · private'}</span>
      </div>
      <div className="creator-notice"><Info size={18} />Page edits autosave to your private draft. Publish when you’re ready to update your page. <Link to="/app/pages" className="creator-muted-link">My pages <ArrowUpRight size={14} /></Link></div>

      {shareMessage ? <p role="status" className="mt-3 text-sm text-ink-soft">{shareMessage}</p> : null}
      {shareError ? <p role="alert" className="mt-3 text-sm text-danger">{shareError}</p> : null}

      {detail.page.moderationStatus !== 'visible' ? (
        <Notice tone="warning" label={`Moderation: ${detail.page.moderationStatus}`} className="mt-6">
          This page cannot be published until its moderation status permits it.
        </Notice>
      ) : null}
      {draftError ? (
        <div role="alert" className="mt-5 border-l-2 border-danger pl-4 text-sm text-danger">
          {errorMessageFor(draftError)}
          {draftConflict ? (
            <>
              <button type="button" className="ml-3 underline underline-offset-4" onClick={useConflictingDraft}>Use latest draft</button>
              <button type="button" className="ml-3 underline underline-offset-4" onClick={overwriteConflictingDraft}>Overwrite with my edits</button>
            </>
          ) : (
            <button type="button" className="ml-3 underline underline-offset-4" onClick={() => setDraftRetry((value) => value + 1)}>Retry save</button>
          )}
        </div>
      ) : null}
      {pageError || actionError ? (
        <div role="alert" className="mt-5 border-l-2 border-danger pl-4 text-sm text-danger">
          {errorMessageFor(pageError ?? actionError)}
        </div>
      ) : null}

      <div className="creator-editor-grid">
        <div className="creator-editor-content">
          <div className="creator-editor-tabs" role="tablist" aria-label="Page editor sections">
            {(['profile', 'links', 'design', 'publish'] as const).map((value, index, tabs) => <button key={value} type="button" role="tab" id={`editor-tab-${value}`} aria-controls={`editor-panel-${value}`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => {
              const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
              const nextTab = next === null ? undefined : tabs[next]
              if (nextTab) { event.preventDefault(); setTab(nextTab); document.getElementById(`editor-tab-${nextTab}`)?.focus() }
            }}>{value === 'profile' ? <UserCircle size={19} /> : value === 'links' ? <LinkSimple size={19} /> : value === 'design' ? <Palette size={19} /> : <RocketLaunch size={19} />}<span>{value === 'publish' ? 'Publishing' : value.charAt(0).toUpperCase() + value.slice(1)}</span></button>)}
          </div>
          <div role="tabpanel" id="editor-panel-profile" aria-labelledby="editor-tab-profile" hidden={tab !== 'profile'}>
            <section className="creator-editor-panel">
              <div className="creator-editor-card-heading"><h2><UserCircle size={21} />Profile details</h2><span className="creator-badge">Your identity</span></div><p>Make a great first impression. Your preview updates as you type.</p>
              {ownsProfile && session.user ? <ProfilePhotoEditor compact user={session.user} readable={accountReadable} writable={accountWritable} onBusyChange={setPhotoBusy} onPreviewChange={setPhoto} /> : <p>{owner ? `Profile photo and socials belong to @${owner.username}. Only the owner can edit them.` : 'Loading profile details…'}</p>}
              <form onSubmit={event => void savePage(event)} className="creator-editor-fields">
                <div className="creator-editor-identity-fields">
                  <Field label="Page display name" maxLength={120} value={pageValues.title} onChange={event => updatePageValue('title', event.currentTarget.value)} hint="Leave blank to use your account display name." />
                  <div id="page-address">
              <Field
                label="Page username"
                maxLength={48}
                value={slugValue}
                onChange={(event) => setSlugValue(event.currentTarget.value)}
                hint={slugMessage ?? 'Changing the address reserves the old one permanently.'}
                error={slugStatus === 'unavailable' ? 'Choose a different address.' : undefined}
              />
                  </div>
                </div>
            {slugStatus === 'checking' ? <p role="status" className="font-mono text-[0.625rem] text-ink-faint">Checking address…</p> : null}
            {slugStatus === 'available' ? <p role="status" className="font-mono text-[0.625rem] text-ink-soft">{slugMessage}</p> : null}
            {slugStatus === 'error' ? <p role="alert" className="font-mono text-[0.625rem] text-danger">{slugMessage}</p> : null}
                <TextareaField label="Short bio" maxLength={500} rows={3} value={pageValues.bio} onChange={event => updatePageValue('bio', event.currentTarget.value)} hint={`Page introduction · ${pageValues.bio.length}/500. Appears above your account bio.`} />
                {slugValue.trim().toLowerCase() !== detail.page.slug.toLowerCase() ? <Button type="submit" pending={pagePending} disabled={slugStatus !== 'available'}>Change address</Button> : null}
              </form>
            </section>
            {ownsProfile ? <section className="creator-editor-panel">
              <SocialsEditor compact readable={accountReadable} writable={accountWritable} blockedReason="Your account must be active to edit social profiles." onPreviewChange={setSocialPreview} onStateChange={setSocialState} />
              <p className="creator-editor-account-note">Photo and social changes save to your account immediately and appear across all your pages.</p>
            </section> : null}
          </div>
          <section role="tabpanel" id="editor-panel-design" aria-labelledby="editor-tab-design" hidden={tab !== 'design'} className="creator-editor-panel space-y-5">
            <div className="creator-editor-card-heading"><h2 id="appearance-heading"><Palette size={21} />Page design</h2></div><p className="creator-muted">Give your page a look that feels like you.</p>
            <div className="grid gap-6 sm:grid-cols-2">
              <SelectField
                label="Theme"
                value={pageValues.theme}
                onChange={(event) => updatePageValue('theme', event.currentTarget.value === 'dark' ? 'dark' : 'light')}
                options={[{ value: 'light', label: 'Black with cyan glow' }, { value: 'dark', label: 'Solid black' }]}
              />
              <SelectField
                label="Link layout"
                value={pageValues.layout}
                onChange={(event) => updatePageValue('layout', event.currentTarget.value === 'grid' ? 'grid' : 'list')}
                options={[{ value: 'list', label: 'Editorial list' }, { value: 'grid', label: 'Compact grid' }]}
              />
            </div>
            <Field label="Accent colour" maxLength={7} value={pageValues.accentColor} onChange={(event) => updatePageValue('accentColor', event.currentTarget.value)} hint="Optional #rrggbb colour." />
            <div className="creator-editor-swatch-row" role="group" aria-label="Accent presets">{['#00d8ef', '#3b82f6', '#a855f7', '#ec4899', '#f59e0b', '#22c55e'].map(color => <button key={color} type="button" style={{ background: color }} aria-label={`Use ${color} accent`} aria-pressed={pageValues.accentColor.toLowerCase() === color} onClick={() => updatePageValue('accentColor', color)} />)}</div>
            <label className="flex items-center gap-3 border-y border-rule py-4 text-sm">
              <input type="checkbox" checked={pageValues.showBranding} onChange={(event) => updatePageValue('showBranding', event.currentTarget.checked)} className="accent-black" />
              Show OneLink credit
            </label>
          </section>

          <section role="tabpanel" id="editor-panel-links" aria-labelledby="editor-tab-links" hidden={tab !== 'links'} className="creator-editor-panel">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-3">
              <div><h2 id="links-heading" className="creator-editor-icon-heading"><LinkSimple size={21} />Your links</h2><p className="creator-muted mt-2">Give your visitors somewhere to go.</p></div>
              <Button variant="outline" onClick={startNewLink}><Plus size={17} />Add a link</Button>
            </div>
            <div className="mt-5 border-y border-rule py-4">
              <p className="eyebrow">Link groups</p>
              <form onSubmit={(event) => void addGroup(event)} className="mt-3 flex flex-wrap gap-2">
                <Field id="new-group" label={editingGroup ? 'Rename group' : 'New group'} maxLength={80} value={groupName} onChange={(event) => setGroupName(event.currentTarget.value)} />
                <div className="flex items-end gap-2">
                  <Button type="submit" variant="outline">{editingGroup ? 'Save group' : 'Add group'}</Button>
                  {editingGroup ? <Button type="button" variant="outline" onClick={() => { setEditingGroup(null); setGroupName('') }}>Cancel</Button> : null}
                </div>
              </form>
              {groups.length ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {groups.map((group, index) => (
                    <li key={group.id} className="flex items-center gap-2 border border-rule px-3 py-2 text-xs">
                      <span>{group.name}</span>
                      <button type="button" aria-label={`Move ${group.name} up`} title="Move group up" disabled={index === 0} onClick={() => moveGroup(index, -1)} className="creator-icon-button"><ArrowUp size={16} /></button>
                      <button type="button" aria-label={`Move ${group.name} down`} title="Move group down" disabled={index === groups.length - 1} onClick={() => moveGroup(index, 1)} className="creator-icon-button"><ArrowDown size={16} /></button>
                      <button type="button" aria-label={`Rename ${group.name}`} title="Rename group" onClick={() => { setEditingGroup(group); setGroupName(group.name) }} className="creator-icon-button"><PencilSimple size={16} /></button>
                      <button type="button" aria-label={`Delete ${group.name}`} title="Delete group" onClick={() => setDeletingGroup(group)} className="creator-icon-button creator-editor-remove"><Trash size={16} /></button>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-3 text-sm text-ink-faint">Groups help visitors scan related links.</p>}
            </div>
            <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter links by group">
              {[{ id: 'all', name: 'All' }, { id: '__ungrouped__', name: 'Ungrouped' }, ...groups].map((group) => (
                <button
                  key={group.id}
                  type="button"
                  aria-pressed={selectedGroup === group.id}
                  onClick={() => setSelectedGroup(group.id)}
                  className={`min-h-9 border px-3 font-mono text-[0.625rem] uppercase tracking-widest ${selectedGroup === group.id ? 'border-ink bg-ink text-white' : 'border-rule text-ink-soft hover:border-ink'}`}
                >
                  {group.name}
                </button>
              ))}
              <Button type="button" variant="outline" onClick={() => document.getElementById('new-group')?.focus()}><Plus size={16} />Group</Button>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2" role="group" aria-label="Link list">
                <Button type="button" variant={listTrash ? 'outline' : undefined} onClick={() => setListTrash(false)}><Eye size={17} />Active links</Button>
                <Button type="button" variant={listTrash ? undefined : 'outline'} onClick={() => setListTrash(true)}><Trash size={17} />Recently removed</Button>
              </div>
              {!listTrash && selectedLinkIds.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[0.625rem] text-ink-soft">{selectedLinkIds.length} selected</span>
                  <Button type="button" variant="outline" disabled={actionPending !== null} onClick={() => void runBulkAction('hide')}>Hide</Button>
                  <Button type="button" variant="outline" disabled={actionPending !== null} onClick={() => void runBulkAction('show')}>Show</Button>
                  <Button type="button" variant="outline" disabled={actionPending !== null} onClick={() => setBulkDeleteOpen(true)}>Remove selected</Button>
                  <select aria-label="Move selected links to group" className="min-h-11 border border-rule bg-transparent px-3 text-sm" defaultValue="" onChange={(event) => { const value = event.currentTarget.value; event.currentTarget.value = ''; if (value) void runBulkAction('move', value === '__ungrouped__' ? null : value) }}>
                    <option value="">Move to group…</option>
                    <option value="__ungrouped__">Ungrouped</option>
                    {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                  </select>
                </div>
              ) : null}
            </div>
            {listTrash ? (
              trashLinks.length === 0 ? (
                <div className="mt-4"><EmptyState title="Nothing in recently removed">Removed links remain recoverable for 30 days.</EmptyState></div>
              ) : (
                <>
                  <p className="mt-3 text-xs text-ink-faint">Removed links are permanently purged 30 days after removal; restore before then.</p>
                  <ul className="mt-3 divide-y divide-rule border-y border-ink">
                    {trashLinks.map((link) => (
                      <li key={link.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                        <div><h3 className="font-medium">{link.title}</h3><p className="mt-1 font-mono text-xs text-ink-soft">{link.url}</p></div>
                        <Button type="button" variant="outline" disabled={actionPending !== null} onClick={() => void restoreLink(link)}>Restore</Button>
                      </li>
                    ))}
                  </ul>
                </>
              )
            ) : detail.links.length === 0 ? (
              <div className="mt-4"><EmptyState title="No links yet">Add the first destination you want people to find.</EmptyState></div>
            ) : visibleRows.length > 0 ? (
              <ol className="mt-3 border-y border-ink">{renderLinkRows(visibleRows)}</ol>
            ) : <p className="mt-4 text-sm text-ink-soft">No visible links match this group.</p>}

            {!listTrash && hiddenRows.length > 0 ? (
              <details className="mt-5 border-t border-rule pt-4" open={hiddenLinksOpen} onToggle={(event) => setHiddenLinksOpen(event.currentTarget.open)}>
                <summary className="cursor-pointer font-display text-lg">Hidden links ({hiddenRows.length})</summary>
                <ol className="mt-2 border-y border-rule">{renderLinkRows(hiddenRows)}</ol>
              </details>
            ) : null}

            <dialog
              ref={linkDialogRef}
              aria-labelledby="link-dialog-title"
              onCancel={(event) => { event.preventDefault(); closeLinkForm() }}
              className="link-editor-dialog m-auto max-h-[calc(100dvh-2rem)] w-[min(42rem,calc(100vw-2rem))] overflow-y-auto border border-ink bg-paper p-0 text-ink shadow-[8px_8px_0_rgba(0,0,0,.12)] backdrop:bg-ink/40"
            >
              {linkOpen ? <form onSubmit={(event) => void saveLink(event)} className="p-5 sm:p-7">
                <div className="flex items-start justify-between gap-4">
                  <div><p className="eyebrow">{editingLink ? 'Edit destination' : 'New destination'}</p><h3 id="link-dialog-title" className="mt-1 font-display text-2xl">{editingLink ? 'Tune this link' : 'Add Link'}</h3></div>
                  <button type="button" aria-label="Close link editor" onClick={closeLinkForm} className="creator-icon-button"><X size={20} /></button>
                </div>
                {linkError ? <p role="alert" className="mt-4 text-sm text-danger">{errorMessageFor(linkError)}</p> : null}
                <div className="mt-5 grid gap-5">
                  <Field label="URL" type="url" maxLength={2048} required value={linkValues.url} onChange={(event) => updateLinkValue('url', event.currentTarget.value)} error={linkErrors.url} hint="Use a full http:// or https:// address." />
                  <div>
                    <Button type="button" variant="outline" disabled={!linkValues.url.trim() || metadataPending} pending={metadataPending} onClick={() => void suggestLinkDetails()}>Fetch title & description</Button>
                  </div>
                  {metadataSuggestion ? (
                    <div className="border border-rule p-4">
                      <p role="status" className="eyebrow">Details found · not applied</p>
                      <p className="mt-2 font-medium">{metadataSuggestion.title || 'No title found'}</p>
                      {metadataSuggestion.description ? <p className="mt-1 text-sm text-ink-soft">{metadataSuggestion.description}</p> : null}
                      <div className="mt-3 flex gap-2">
                        <Button type="button" variant="outline" onClick={() => {
                          setLinkValues((current) => ({
                            ...current,
                            title: metadataSuggestion.title?.trim() || current.title,
                            description: metadataSuggestion.description?.trim() || current.description,
                          }))
                          setMetadataSuggestion(null)
                        }}>Apply suggestion</Button>
                        <Button type="button" variant="outline" onClick={() => setMetadataSuggestion(null)}>Ignore</Button>
                      </div>
                    </div>
                  ) : null}
                  <Field label="Title" maxLength={140} required value={linkValues.title} onChange={(event) => updateLinkValue('title', event.currentTarget.value)} error={linkErrors.title} hint={`${linkValues.title.length}/140 characters`} />
                  <TextareaField label="Description (optional)" maxLength={280} rows={3} value={linkValues.description} onChange={(event) => updateLinkValue('description', event.currentTarget.value)} hint={`${linkValues.description.length}/280 characters`} />
                  <SelectField
                    label="Group"
                    value={linkValues.groupId}
                    onChange={(event) => updateLinkValue('groupId', event.currentTarget.value)}
                    options={[{ value: '', label: 'Ungrouped' }, ...groups.map((group) => ({ value: group.id, label: group.name }))]}
                  />
                  <label className="flex items-center gap-3 border-y border-rule py-4 text-sm">
                    <input type="checkbox" checked={linkValues.openInNewTab} onChange={(event) => updateLinkValue('openInNewTab', event.currentTarget.checked)} className="accent-black" />
                    Open in a new tab
                  </label>
                  <div className="space-y-3 border-y border-rule py-4">
                    <label className="block text-sm">
                      Link thumbnail
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={imagePending}
                        onChange={(event) => { void uploadThumbnail(event.currentTarget.files?.[0]); event.currentTarget.value = '' }}
                        className="mt-2 block w-full text-sm"
                      />
                    </label>
                    {linkValues.thumbnailKey ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <img src={uploadedImage?.key === linkValues.thumbnailKey ? uploadedImage.url : `/api/v1/media/files/${linkValues.thumbnailKey}`} alt="" className="h-16 w-32 object-cover" />
                        <Button type="button" variant="outline" disabled={imagePending} onClick={() => updateLinkValue('thumbnailKey', '')}>Remove thumbnail</Button>
                      </div>
                    ) : <p className="text-xs text-ink-faint">JPEG, PNG or WebP · up to 10 MB.</p>}
                    {imageError ? <p role="alert" className="text-sm text-danger">{imageError}</p> : null}
                  </div>
                  <label className="flex items-center gap-3 text-sm">
                    <input type="checkbox" checked={linkValues.isVisible} onChange={(event) => updateLinkValue('isVisible', event.currentTarget.checked)} className="accent-black" />
                    Show this link on the public page
                  </label>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field label="Starts at (local time)" type="datetime-local" value={linkValues.startsAt} onChange={(event) => updateLinkValue('startsAt', event.currentTarget.value)} />
                    <Field label="Ends at (local time)" type="datetime-local" value={linkValues.endsAt} onChange={(event) => updateLinkValue('endsAt', event.currentTarget.value)} />
                  </div>
                  <p className="font-mono text-[0.625rem] leading-relaxed text-ink-faint">Empty time bounds mean no schedule limit. Dates use your device’s local time.</p>
                  <div className="flex flex-wrap gap-3">
                    <Button type="submit" disabled={imagePending || metadataPending}>{editingLink ? 'Save link' : 'Add link'}</Button>
                    <Button type="button" variant="outline" onClick={closeLinkForm} disabled={imagePending || metadataPending}>Cancel</Button>
                  </div>
                </div>
              </form> : null}
            </dialog>
          </section>

          <section role="tabpanel" id="editor-panel-publish" aria-labelledby="editor-tab-publish" hidden={tab !== 'publish'} className="creator-editor-panel">
            <h2 id="publish-heading" className="creator-editor-icon-heading"><RocketLaunch size={21} />Publication</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">
              {hasUnsaved ? 'Your latest edits are still saving. Wait for autosave before publishing.' : 'Publishing replaces the live page with your saved draft.'}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-4">
              {detail.page.status === 'published' ? (
                <Button variant="outline" disabled={hasUnsaved || actionPending !== null} pending={actionPending === 'unpublish'} onClick={() => void changePublication('unpublish')}>Unpublish page</Button>
              ) : (
                <Button
                  disabled={(hasUnsaved && !(draftStatus === 'error' && draftDirty)) || actionPending !== null || detail.page.moderationStatus !== 'visible'}
                  pending={actionPending === 'publish'}
                  onClick={() => void changePublication('publish')}
                >
                  {draftStatus === 'error' && draftDirty ? 'Publish last saved version' : 'Publish page'}
                </Button>
              )}
              {draft?.unpublishedChanges ? (
                <Button type="button" variant="outline" disabled={draftDirty || draftStatus !== 'saved' || draftActionPending} onClick={() => setDiscardDraftOpen(true)}>Discard draft</Button>
              ) : null}
              <Button type="button" variant="outline" onClick={() => void openRevisionHistory()}><ClockCounterClockwise size={17} />Version history</Button>
              {detail.page.status === 'published' ? <Button type="button" variant="outline" onClick={() => void sharePublicPage()}>Share page</Button> : null}
              <Link className="creator-button" to={`/app/share?page=${id}`}>Share &amp; QR</Link>
              {detail.page.status === 'published' && detail.page.moderationStatus === 'visible' ? <PublishedPageLink slug={detail.page.slug} className="creator-button"><ArrowUpRight size={17} />View live</PublishedPageLink> : null}
              <Button type="button" variant="outline" onClick={() => setDeletingPage(true)}><Trash size={17} />Delete page</Button>
              {detail.page.publishedAt ? <span className="font-mono text-[0.625rem] uppercase tracking-widest text-ink-faint">Published {new Date(detail.page.publishedAt).toLocaleString()}</span> : null}
            </div>
            {qrOpen && detail.page.status === 'published' ? <div className="mt-4"><Button type="button" variant="outline" onClick={() => setQrOpen(false)}>Close QR tools</Button><QrCodeTools url={publicUrl} name={detail.page.slug} /></div> : null}
            {revisionsOpen ? (
              <div className="mt-4 border border-rule p-4" aria-live="polite">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-lg">Published versions</h3>
                  <button type="button" className="text-sm underline underline-offset-4" onClick={() => setRevisionsOpen(false)}>Close</button>
                </div>
                {revisionError ? <p role="alert" className="mt-3 text-sm text-danger">{errorMessageFor(revisionError)}</p> : null}
                {revisions.length === 0 && !revisionError ? <p className="mt-3 text-sm text-ink-faint">No published versions yet.</p> : null}
                <ol className="mt-3 divide-y divide-rule">
                  {revisions.map((revision) => (
                    <li key={revision.revision} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <span className="text-sm">Revision {revision.revision} · {new Date(revision.createdAt).toLocaleString()} · {revision.reason}</span>
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" onClick={() => void inspectRevision(revision.revision)}>Inspect</Button>
                        <Button type="button" variant="outline" disabled={draftActionPending || draftStatus !== 'saved'} onClick={() => setSelectedRevision(revision.revision)}>Restore to draft</Button>
                      </div>
                    </li>
                  ))}
                </ol>
                {revisionPreview ? (
                  <div className="mt-4 border border-rule">
                    <p className="eyebrow p-3">Revision {revisionDetail?.meta.revision} preview</p>
                    <PageRenderer page={revisionPreview} />
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>

        <div className="creator-editor-preview">
          {livePreview ? <CreatorPreview page={livePreview} photo={ownsProfile ? photo : null} draftNotice="Previewing your draft. Publish to update your page. Photo and social changes are saved to your account immediately." />
            : previewError ? <ErrorNotice error={previewError} action="Retry preview" onRetry={() => void loadServerPreview()} />
              : <p role="status">{previewPending ? 'Refreshing your preview…' : 'Preparing your preview…'}</p>}
        </div>
      </div>

      <ConfirmDialog
        open={publishSavedDraftOpen}
        title="Publish the last saved draft?"
        confirmLabel="Publish saved version"
        pending={actionPending === 'publish'}
        onConfirm={() => void changePublication('publish', true)}
        onCancel={() => { if (actionPending !== 'publish') setPublishSavedDraftOpen(false) }}
      >
        Autosave failed, so your latest edits are not included. Publishing uses the last successfully saved draft and reloads the editor afterward.
        {draftError ? <p role="alert" className="mt-3 text-danger">{errorMessageFor(draftError)}</p> : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={discardDraftOpen}
        title="Discard the saved draft?"
        confirmLabel="Discard draft"
        tone="danger"
        pending={draftActionPending}
        onConfirm={() => void discardDraft()}
        onCancel={() => { if (!draftActionPending) setDiscardDraftOpen(false) }}
      >
        This restores the page editor to the currently published version. Your published page will not change.
        {draftError ? <p role="alert" className="mt-3 text-danger">{errorMessageFor(draftError)}</p> : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={selectedRevision !== null}
        title={`Restore revision ${selectedRevision ?? ''} to draft?`}
        confirmLabel="Restore version"
        pending={draftActionPending}
        onConfirm={() => void restoreRevision()}
        onCancel={() => { if (!draftActionPending) setSelectedRevision(null) }}
      >
        The selected version will replace the current saved draft. It will not become public until you publish.
        {revisionError ? <p role="alert" className="mt-3 text-danger">{errorMessageFor(revisionError)}</p> : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={renameConfirmOpen}
        title={`Change this page address to “${availableSlug || slugValue.trim().toLowerCase()}”?`}
        confirmLabel="Change address"
        pending={pagePending}
        onConfirm={() => void commitPageSave()}
        onCancel={() => { if (!pagePending) setRenameConfirmOpen(false) }}
      >
        <p>The current address <strong>/{detail.page.slug}</strong> will remain reserved. The new address will be <strong>{publicPagePath(availableSlug || slugValue.trim().toLowerCase())}</strong>.</p>
        <p className="mt-2">Published version history is retained and the change is recorded for the account audit.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={navigation.blocked}
        title="Leave without saving?"
        confirmLabel="Leave editor"
        onConfirm={navigation.proceed}
        onCancel={navigation.stay}
      >
        {linkDirty ? <p>A link form that has not been added will be lost.</p> : null}
        {groupDirty ? <p>Your unfinished group name has not been saved.</p> : null}
        {accountUnsaved ? <p>Finish or discard your photo and social edits before leaving to keep those changes.</p> : null}
        {slugValue.trim().toLowerCase() !== detail.page.slug.toLowerCase() ? <p>Your page address change has not been confirmed.</p> : null}
        {draftStatus === 'error'
          ? <p>The latest page edits could not be saved and will be lost if you leave.</p>
          : draftDirty
            ? <p>Page edits are still saving. Wait for the saved indicator before leaving.</p>
            : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={discardLinkOpen}
        title="Discard this link edit?"
        confirmLabel="Discard changes"
        tone="danger"
        onConfirm={discardLinkForm}
        onCancel={() => setDiscardLinkOpen(false)}
      >
        Your unsaved title, destination, description and schedule will be cleared.
      </ConfirmDialog>
      <ConfirmDialog
        open={deletingGroup !== null}
        title={`Remove “${deletingGroup?.name ?? 'this group'}”?`}
        confirmLabel="Remove group"
        tone="danger"
        pending={false}
        onConfirm={() => void confirmRemoveGroup()}
        onCancel={() => setDeletingGroup(null)}
      >
        Links in this group will remain on the page but become ungrouped.
      </ConfirmDialog>
      <ConfirmDialog
        open={deletingLink !== null}
        title={`Remove “${deletingLink?.title ?? 'this link'}”?`}
        confirmLabel="Remove link"
        tone="danger"
        pending={deletePending}
        onConfirm={() => void removeLink()}
        onCancel={() => { if (!deletePending) setDeletingLink(null) }}
      >
        This removes the link from your saved draft. If you publish, it enters Recently removed and can be restored for 30 days.
        {deleteError ? <p role="alert" className="mt-3 text-danger">{errorMessageFor(deleteError)}</p> : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={bulkDeleteOpen}
        title={`Remove ${selectedLinkIds.length} selected links?`}
        confirmLabel="Remove links"
        tone="danger"
        onConfirm={confirmBulkRemove}
        onCancel={() => setBulkDeleteOpen(false)}
      >
        Removed links leave the draft. After publishing, they appear in Recently removed and can be restored for 30 days.
      </ConfirmDialog>
      <ConfirmDialog
        open={deletingPage}
        title={`Delete “${detail.page.title || detail.page.slug}”?`}
        confirmLabel="Delete page"
        tone="danger"
        pending={deletePending}
        onConfirm={() => void removePage()}
        onCancel={() => { if (!deletePending) setDeletingPage(false) }}
      >
        The page and its links will be removed. The address <strong>/{detail.page.slug}</strong> stays reserved.
        {deleteError ? <p role="alert" className="mt-3 text-danger">{errorMessageFor(deleteError)}</p> : null}
      </ConfirmDialog>
    </section>
  )
}
