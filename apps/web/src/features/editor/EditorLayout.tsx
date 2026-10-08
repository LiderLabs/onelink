import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import type { IconName } from '../../components/Icon'
import { IconButton } from '../../components/IconButton'
import { EmptyState } from '../../components/EmptyState'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Splash } from '../../components/StatusScreens'
import { errorMessageFor } from '../../lib/api'
import { cx } from '../../lib/css'
import { useSession } from '../../lib/session'
import type { OwnerPage, PageDraftContent, PageDraftState } from '../../lib/types'
import { discardPageDraft, getPageDraft, listMyPages, publicPagePath, publishPage, savePageDraft } from '../pages/api'
import { ProfileAvatar } from '../profile/ProfileAvatar'
import { ProfileScreen } from '../profile/ProfileScreen'
import { EditorContext, newKey, toEditorPage } from './context'
import type { EditorContextValue, EditorGroup, EditorLink, EditorPage, EditorSaveStatus } from './context'

// ============================================================================
// The merged editor shell.
//
// One family of tabs — Profile, Links, Design, Analytics, Settings — over one
// account and one page. The shell owns everything the tabs share: which page is
// being edited, the working draft, autosave, and the publish/discard lifecycle.
// A tab only renders fields and calls `useEditor().patchPage` / `.setLinks`;
// none of them talks to the draft API directly, so no two tabs can disagree
// about what "unpublished" means.
//
// The write model is the draft, not the live page. Edits autosave into the
// account's private draft (R1.6); Publish promotes it. That is what makes the
// bottom bar's "unpublished changes" honest: it is the server's own answer, not
// a client guess.
// ============================================================================

interface EditorTab {
  slug: string
  label: string
  icon: IconName
  /** Account-level tabs ignore the `?page=` selection. */
  account: boolean
}

const TABS: readonly EditorTab[] = [
  { slug: 'profile', label: 'Profile', icon: 'profile', account: true },
  { slug: 'links', label: 'Links', icon: 'links', account: false },
  { slug: 'design', label: 'Design', icon: 'design', account: false },
  { slug: 'analytics', label: 'Analytics', icon: 'analytics', account: false },
  { slug: 'settings', label: 'Settings', icon: 'settings', account: false },
]

/** Decompose the draft's links into the editor's keyed working rows. */
function linksFromContent(content: PageDraftContent): EditorLink[] {
  return content.links.map((link) => ({
    key: link.id ?? newKey(),
    id: link.id ?? null,
    title: link.title,
    url: link.url,
    description: link.description ?? '',
    icon: link.icon,
    isVisible: link.isVisible,
    groupId: link.groupId,
    openInNewTab: link.openInNewTab,
    thumbnailKey: link.thumbnailKey,
    startsAt: link.startsAt,
    endsAt: link.endsAt,
  }))
}

function groupsFromContent(content: PageDraftContent): EditorGroup[] {
  return content.groups.map((group) => ({
    key: group.id ?? newKey(),
    id: group.id ?? null,
    name: group.name,
  }))
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/** Serialise the working state back into the draft envelope the API expects. */
function contentFromState(page: EditorPage, groups: EditorGroup[], links: EditorLink[]): PageDraftContent {
  const accent = page.accentColor.trim()
  // A link may only point at a group the server already knows. A group created in
  // this session has no id until the first save, so a link aimed at it is left
  // ungrouped rather than sent with an id the server would reject as unknown.
  const knownGroupIds = new Set(groups.flatMap((group) => (group.id ? [group.id] : [])))
  return {
    v: 1,
    page: {
      title: page.title.trim() || null,
      bio: page.bio.trim() || null,
      theme: page.theme,
      layout: page.layout,
      accentColor: HEX_COLOR.test(accent) ? accent : null,
      showBranding: page.showBranding,
    },
    groups: groups.map((group) => ({
      ...(group.id ? { id: group.id } : {}),
      name: group.name.trim() || 'Group',
    })),
    links: links
      .filter((link) => link.title.trim() !== '' && link.url.trim() !== '')
      .map((link) => ({
        ...(link.id ? { id: link.id } : {}),
        title: link.title.trim(),
        url: link.url.trim(),
        description: link.description.trim() || null,
        icon: link.icon,
        isVisible: link.isVisible,
        groupId: link.groupId && knownGroupIds.has(link.groupId) ? link.groupId : null,
        openInNewTab: link.openInNewTab,
        thumbnailKey: link.thumbnailKey,
        startsAt: link.startsAt,
        endsAt: link.endsAt,
      })),
  }
}

function signatureOf(page: EditorPage, groups: EditorGroup[], links: EditorLink[]): string {
  return JSON.stringify(contentFromState(page, groups, links))
}

export function EditorLayout() {
  const { user, platformName, mustChangePassword } = useSession()
  const canManage = Boolean(user && user.status === 'active' && !mustChangePassword && user.impersonatedBy === null)

  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const activeSlug = location.pathname.split('/')[3] ?? 'profile'
  const queryPageId = params.get('page')

  const [pages, setPages] = useState<OwnerPage[] | null>(null)
  const [pagesError, setPagesError] = useState<unknown>(null)
  const [retry, setRetry] = useState(0)

  const [draft, setDraft] = useState<PageDraftState | null>(null)
  const [draftError, setDraftError] = useState<unknown>(null)

  const [draftPage, setDraftPage] = useState<EditorPage | null>(null)
  const [links, setLinksState] = useState<EditorLink[]>([])
  const [groups, setGroupsState] = useState<EditorGroup[]>([])
  const [savedSig, setSavedSig] = useState('')
  const [status, setStatus] = useState<EditorSaveStatus>('idle')
  const [error, setError] = useState<unknown>(null)
  const [publishing, setPublishing] = useState(false)

  // --- the page list: the editor works on exactly one page at a time --------
  useEffect(() => {
    if (!canManage) {
      setPages([])
      return
    }
    let current = true
    setPages(null)
    setPagesError(null)
    void listMyPages(1, 50).then((result) => {
      if (current) setPages(result.items)
    }).catch((cause: unknown) => {
      if (current) setPagesError(cause)
    })
    return () => { current = false }
  }, [canManage, retry])

  const activePageId = useMemo(() => {
    if (!pages || pages.length === 0) return ''
    if (queryPageId && pages.some((page) => page.id === queryPageId)) return queryPageId
    return pages[0]?.id ?? ''
  }, [pages, queryPageId])

  const page = useMemo(
    () => pages?.find((candidate) => candidate.id === activePageId) ?? null,
    [pages, activePageId],
  )

  // --- the draft: the working copy the tabs edit ----------------------------
  useEffect(() => {
    if (!activePageId) {
      setDraft(null)
      return
    }
    let current = true
    setDraft(null)
    setDraftError(null)
    void getPageDraft(activePageId).then((result) => {
      if (current) setDraft(result.draft)
    }).catch((cause: unknown) => {
      if (current) setDraftError(cause)
    })
    return () => { current = false }
  }, [activePageId, retry])

  useEffect(() => {
    if (!draft) return
    const nextPage = toEditorPage(draft.content.page)
    const nextGroups = groupsFromContent(draft.content)
    const nextLinks = linksFromContent(draft.content)
    setDraftPage(nextPage)
    setGroupsState(nextGroups)
    setLinksState(nextLinks)
    setSavedSig(signatureOf(nextPage, nextGroups, nextLinks))
    setStatus('idle')
    setError(null)
  }, [draft])

  const currentSig = draftPage ? signatureOf(draftPage, groups, links) : ''
  const dirty = draftPage !== null && currentSig !== savedSig
  const unpublished = dirty || Boolean(draft?.unpublishedChanges) || Boolean(page?.unpublishedChanges)

  const saveRef = useRef<() => Promise<void>>(async () => {})
  const save = useCallback(async () => {
    if (!draftPage || !activePageId) return
    setStatus('saving')
    setError(null)
    try {
      const content = contentFromState(draftPage, groups, links)
      const result = await savePageDraft(activePageId, content, draft?.updatedAt ?? null)
      setDraft(result.draft)
    } catch (cause: unknown) {
      setError(cause)
      setStatus('error')
    }
  }, [draftPage, groups, links, activePageId, draft?.updatedAt])
  saveRef.current = save

  // Autosave, debounced. Never fires for a read-only session or a clean draft.
  useEffect(() => {
    if (!canManage || !dirty || !draftPage || status === 'saving') return
    const timer = window.setTimeout(() => { void saveRef.current() }, 700)
    return () => window.clearTimeout(timer)
  }, [canManage, dirty, currentSig, draftPage, status])

  const discard = useCallback(async () => {
    if (!activePageId) return
    setError(null)
    try {
      const result = await discardPageDraft(activePageId)
      setDraft(result.draft)
      setRetry((value) => value + 1)
    } catch (cause: unknown) {
      setError(cause)
      setStatus('error')
    }
  }, [activePageId])

  const publish = useCallback(async () => {
    if (!activePageId) return
    setPublishing(true)
    setError(null)
    try {
      if (dirty) {
        const content = contentFromState(draftPage ?? toEditorPage(draft!.content.page), groups, links)
        await savePageDraft(activePageId, content, draft?.updatedAt ?? null)
      }
      await publishPage(activePageId)
      setRetry((value) => value + 1)
    } catch (cause: unknown) {
      setError(cause)
    } finally {
      setPublishing(false)
    }
  }, [activePageId, dirty, draftPage, draft, groups, links])

  const selectPage = useCallback((id: string) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.set('page', id)
      return next
    }, { replace: true })
  }, [setParams])

  const reload = useCallback(() => setRetry((value) => value + 1), [])

  const [copied, setCopied] = useState(false)
  const copyPublicLink = useCallback(async () => {
    if (!page) return
    try {
      const url = new URL(publicPagePath(page.slug), window.location.origin).href
      if (navigator.share) {
        await navigator.share({ url, title: page.title ?? page.slug })
        return
      }
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* A dismissed share sheet or a locked clipboard is not an error to shout about. */
    }
  }, [page])

  const contextValue = useMemo<EditorContextValue | null>(() => {
    if (!page || !draftPage) return null
    return {
      pages: pages ?? [],
      pagesLoading: pages === null,
      page,
      activePageId,
      selectPage,
      draftPage,
      links,
      groups,
      patchPage: (patch) => setDraftPage((current) => (current ? { ...current, ...patch } : current)),
      setLinks: setLinksState,
      setGroups: setGroupsState,
      status,
      unpublished,
      error,
      save,
      discard,
      publish,
      publishing,
      reload,
      canManage,
    }
  }, [page, pages, activePageId, selectPage, draftPage, links, groups, status, unpublished, error, save, discard, publish, publishing, reload, canManage])

  if (pagesError) {
    return (
      <div className="mx-auto max-w-2xl">
        <ErrorNotice error={pagesError} action="Try again" onRetry={reload} />
      </div>
    )
  }

  if (pages === null) return <Splash label="Loading your editor" />

  const noPages = pages.length === 0
  const ready = contextValue !== null

  return (
    <div className="mx-auto max-w-7xl">
      <header className="border-b border-rule">
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 py-3">
          <div className="flex items-center gap-2.5">
            <Link to="/app" className="inline-flex items-center gap-2.5 font-display text-xl font-medium tracking-tight">
              <span className="grid h-8 w-8 place-items-center rounded-lg border border-ink font-sans text-sm font-semibold">B</span>
              {platformName}
            </Link>
            <span className="border border-rule px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-ink-soft">Editor</span>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {page ? (
              <>
                <Button variant="ghost" size="sm" disabled={!canManage || !unpublished} onClick={() => void discard()}>Discard</Button>
                <Button variant="outline" size="sm" onClick={() => window.open(publicPagePath(page.slug), '_blank', 'noopener')}>
                  <Icon name="eye" size={16} /> Preview
                </Button>
                <Button size="sm" pending={publishing} disabled={!canManage || !unpublished} onClick={() => void publish()}>
                  <Icon name="upload" size={16} /> Publish
                </Button>
                <IconButton icon={copied ? 'check' : 'share'} label={copied ? 'Link copied' : 'Share page'} onClick={() => void copyPublicLink()} />
              </>
            ) : null}
            <Link to="/app/editor/profile" className="ml-1 inline-flex items-center gap-2 rounded-md border border-rule py-1 pl-1 pr-2.5">
              <ProfileAvatar avatarKey={user?.avatarKey ?? null} displayName={user?.displayName ?? ''} className="h-7 w-7 rounded-full" />
              <span className="hidden text-sm sm:inline">{user?.displayName || 'Account'}</span>
              <Icon name="chevron-down" size={14} />
            </Link>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-rule">
          <nav role="tablist" aria-label="Editor sections" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {TABS.map((tab) => {
              const active = tab.slug === activeSlug
              const to = tab.account || !activePageId
                ? `/app/editor/${tab.slug}`
                : { pathname: `/app/editor/${tab.slug}`, search: `?page=${encodeURIComponent(activePageId)}` }
              return (
                <NavLink
                  key={tab.slug}
                  to={to}
                  role="tab"
                  aria-selected={active}
                  className={cx(
                    'inline-flex items-center gap-2 border-b-2 px-3 py-3 font-mono text-[0.6875rem] uppercase tracking-[0.12em] transition-colors',
                    active ? 'border-ink text-ink' : 'border-transparent text-ink-soft hover:text-ink',
                  )}
                >
                  <Icon name={tab.icon} size={16} />
                  {tab.label}
                </NavLink>
              )
            })}
          </nav>
          {page ? (
            <div className="hidden items-center gap-1 pr-1 sm:flex">
              <span className="inline-flex items-center gap-1.5 font-mono text-[0.6875rem] text-ink-soft">
                <span
                  aria-hidden="true"
                  className={cx('h-1.5 w-1.5 rounded-full', page.status === 'published' ? 'bg-ink' : 'border border-ink-soft')}
                />
                {platformName.toLowerCase()}.me{publicPagePath(page.slug)}
              </span>
              <IconButton icon="copy" label="Copy public link" onClick={() => void copyPublicLink()} />
            </div>
          ) : null}
        </div>
      </header>

      <div className="py-7 sm:py-9">
        {page && pages.length > 1 ? (
          <label className="mb-5 flex flex-wrap items-center gap-3">
            <span className="eyebrow">Editing page</span>
            <select
              value={activePageId}
              onChange={(event) => selectPage(event.currentTarget.value)}
              className="border border-rule bg-transparent px-3 py-2 text-sm"
            >
              {pages.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.title?.trim() || candidate.slug}</option>
              ))}
            </select>
          </label>
        ) : null}

        {draftError ? (
          <ErrorNotice error={draftError} action="Load the page again" onRetry={reload} />
        ) : error ? (
          <div role="alert" className="mb-5 border-l-2 border-danger bg-paper-deep/60 py-3 pl-4 pr-3 text-sm text-danger">
            {errorMessageFor(error)}
          </div>
        ) : null}

        {ready ? (
          <EditorContext.Provider value={contextValue}>
            <Outlet />
          </EditorContext.Provider>
        ) : noPages ? (
          activeSlug === 'profile' ? <ProfileScreen /> : (
            <EmptyState
              title="No page to edit yet"
              action={<Link to="/app/pages/new" className="inline-flex items-center gap-2 border border-ink bg-ink px-5 py-3 font-mono text-xs uppercase tracking-[0.18em] text-paper transition-colors hover:bg-paper hover:text-ink">Create a page</Link>}
            >
              Create a page to manage its links, design, and settings from here.
            </EmptyState>
          )
        ) : (
          <Splash label="Loading your page" />
        )}
      </div>
    </div>
  )
}
