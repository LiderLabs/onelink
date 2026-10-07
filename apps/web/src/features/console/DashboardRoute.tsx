import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Splash } from '../../components/StatusScreens'
import { errorMessageFor } from '../../lib/api'
import { useSession } from '../../lib/session'
import type { OwnerPage, OwnerPageDetail, PageDraftState } from '../../lib/types'
import { listMyPages, getPage, getPageDraft, publicPagePath, publishPage, savePageDraft } from '../pages/api'
import { ProfileScreen } from '../profile/ProfileScreen'
import { ProfileAvatar } from '../profile/ProfileAvatar'

export function DashboardRoute() {
  const { user, platformName, mustChangePassword } = useSession()
  const canManagePages = Boolean(user && user.status === 'active' && !mustChangePassword && user.impersonatedBy === null)
  const [pages, setPages] = useState<OwnerPage[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [retry, setRetry] = useState(0)
  const [detail, setDetail] = useState<OwnerPageDetail | null>(null)
  const [draft, setDraft] = useState<PageDraftState | null>(null)
  const [detailError, setDetailError] = useState<unknown>(null)
  const [detailRetry, setDetailRetry] = useState(0)
  const [linkActionError, setLinkActionError] = useState<string | null>(null)
  const [linkActionStatus, setLinkActionStatus] = useState<string | null>(null)
  const [linkActionPending, setLinkActionPending] = useState(false)
  const [removingLink, setRemovingLink] = useState<number | null>(null)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)
  const [publishPending, setPublishPending] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

  useEffect(() => {
    document.title = `Dashboard · ${platformName}`
    let current = true
    setPages(canManagePages ? null : [])
    setError(null)
    if (!canManagePages) return () => { current = false }
    void listMyPages(1, 12).then((result) => {
      if (current) setPages(result.items)
    }).catch((cause: unknown) => {
      if (current) setError(cause)
    })
    return () => { current = false }
  }, [canManagePages, platformName, retry])

  const firstPage = pages?.[0]
  const publishedPage = pages?.find((page) => page.status === 'published')
  const featuredPage = publishedPage ?? firstPage

  useEffect(() => {
    if (!featuredPage) {
      setDetail(null)
      setDraft(null)
      setDetailError(null)
      return
    }
    let current = true
    setDetail(null)
    setDraft(null)
    setDetailError(null)
    void Promise.all([getPage(featuredPage.id), getPageDraft(featuredPage.id)]).then(([result, draftResult]) => {
      if (current) {
        setDetail(result)
        setDraft(draftResult.draft)
      }
    }).catch((cause: unknown) => {
      if (current) setDetailError(cause)
    })
    return () => { current = false }
  }, [featuredPage?.id, detailRetry])

  const publicUrl = featuredPage
    ? new URL(publicPagePath(featuredPage.slug), window.location.origin)
    : null

  const copyPublicLink = async () => {
    if (!publicUrl) return
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.')
      await navigator.clipboard.writeText(publicUrl.href)
      setCopyStatus('Public link copied.')
    } catch {
      setCopyStatus('Could not copy the public link. Open the page to copy its address.')
    }
  }

  const sharePage = async () => {
    if (!featuredPage || !publicUrl) return
    setShareError(null)
    if (navigator.share) {
      try {
        await navigator.share({ title: featuredPage.title?.trim() || featuredPage.slug, url: publicUrl.href })
        return
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setShareError('Sharing could not be completed. You can still copy the page link.')
        return
      }
    }
    await copyPublicLink()
  }

  const publish = async () => {
    if (!featuredPage || publishPending) return
    setPublishPending(true)
    setPublishError(null)
    try {
      await publishPage(featuredPage.id)
      setRetry((value) => value + 1)
      setDetailRetry((value) => value + 1)
    } catch {
      setPublishError('Publishing did not complete. Open the editor to review the saved draft and try again.')
    } finally {
      setPublishPending(false)
    }
  }

  const saveLinkDraft = async (links: PageDraftState['content']['links']) => {
      if (!featuredPage || !draft || linkActionPending) return
      setLinkActionPending(true)
      setLinkActionError(null)
      setLinkActionStatus(null)
      try {
        const result = await savePageDraft(featuredPage.id, { ...draft.content, links }, draft.updatedAt)
        setDraft(result.draft)
        setPages((current) => current?.map((page) => page.id === featuredPage.id
          ? { ...page, unpublishedChanges: true }
          : page) ?? null)
        setLinkActionStatus('Draft link changes saved. Publish to update your live page.')
      } catch (cause) {
        setLinkActionError(errorMessageFor(cause))
      } finally {
        setLinkActionPending(false)
      }
  }

  const moveLink = (index: number, direction: -1 | 1) => {
    if (!draft) return
    const target = index + direction
    if (target < 0 || target >= draft.content.links.length) return
    const links = [...draft.content.links]
    const [moved] = links.splice(index, 1)
    if (!moved) return
    links.splice(target, 0, moved)
    void saveLinkDraft(links)
  }

  const toggleLink = (index: number) => {
    if (!draft) return
    const links = draft.content.links.map((link, position) =>
      position === index ? { ...link, isVisible: !link.isVisible } : link)
    void saveLinkDraft(links)
  }

  const removeLink = () => {
    if (removingLink === null || !draft) return
    const links = draft.content.links.filter((_, index) => index !== removingLink)
    setRemovingLink(null)
    void saveLinkDraft(links)
  }

  if (pages === null && error === null) return <Splash label="Opening your dashboard" />

  const links = draft?.content.links ?? []
  const canPublish = Boolean(featuredPage && (
    featuredPage.status !== 'published' || featuredPage.unpublishedChanges
  ))

  return (
    <section className="mx-auto max-w-7xl">
      <div className="flex flex-wrap items-end justify-between gap-5 border-b border-rule pb-6">
        <div>
          <p className="eyebrow">Your corner of the internet</p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl">
            Welcome{user?.displayName ? `, ${user.displayName}` : ''}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {featuredPage?.status === 'published' ? (
            <a href={publicPagePath(featuredPage.slug)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-xl border border-ink/20 bg-paper-deep px-4 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink transition-colors hover:border-ink hover:bg-paper">
              Preview <span className="ml-2" aria-hidden="true">↗</span>
            </a>
          ) : <Button type="button" variant="outline" disabled>Preview</Button>}
          <Button type="button" variant="outline" disabled={!featuredPage} onClick={() => void sharePage()}>Share</Button>
          <Button type="button" disabled={!canPublish || publishPending} pending={publishPending} onClick={() => void publish()}>
            Publish{featuredPage?.unpublishedChanges ? <span className="ml-1 text-ink-faint" aria-label="Unpublished changes">●</span> : null}
          </Button>
          <a href="/app#profile-editor" className="ml-2 inline-flex items-center gap-2 rounded-xl border border-rule bg-paper-deep px-3 py-2" aria-label={`Profile menu for @${user?.username ?? ''}`}>
            <ProfileAvatar avatarKey={user?.avatarKey ?? null} displayName={user?.displayName ?? ''} className="h-9 w-9 rounded-full" />
            <span className="hidden text-sm text-ink-soft sm:inline">{user?.displayName || 'Profile'} <span aria-hidden="true">▾</span></span>
          </a>
        </div>
      </div>
      {error ? <ErrorNotice error={error} action="Load your dashboard again" onRetry={() => setRetry((value) => value + 1)} /> : null}
      {publishError ? <p role="alert" className="mt-4 border-l-2 border-danger pl-4 text-sm text-danger">{publishError}</p> : null}
      {copyStatus ? <p role="status" className="mt-3 text-sm text-ink-soft">{copyStatus}</p> : null}
      {shareError ? <p role="alert" className="mt-3 text-sm text-danger">{shareError}</p> : null}

      {!canManagePages ? <p role="status" className="mt-6 border-l-2 border-rule pl-4 text-sm text-ink-soft">Page management is unavailable for this session. Your profile, social links, and security settings are available below.</p> : null}
      {!error && canManagePages && pages?.length === 0 ? (
        <div className="mt-8 grid gap-5 sm:grid-cols-[minmax(13rem,.7fr)_minmax(0,1.3fr)]">
          <EmptyState
            title="Start with one page."
            action={<Link to="/app/pages/new" className="font-mono text-xs uppercase tracking-[0.14em] underline underline-offset-4">Create your first page</Link>}
          >
            Your page will bring your links together. Views and click counts are not collected yet.
          </EmptyState>
        </div>
      ) : null}

      {featuredPage ? (
        <>
          <section aria-label="Page and profile overview" className="mt-6 grid gap-4 lg:grid-cols-12">
            <article className="flex min-w-0 flex-col items-start justify-center border border-rule bg-white/80 p-5 sm:p-6 lg:col-span-5">
              <ProfileAvatar avatarKey={user?.avatarKey ?? null} displayName={user?.displayName ?? ''} className="h-20 w-20 rounded-full" />
              <p className="eyebrow mt-5">Profile</p>
              <h2 className="mt-1 wrap-break-word font-display text-2xl font-medium">{user?.displayName || 'Your name'}</h2>
              <p className="mt-1 font-mono text-xs text-ink-soft">@{user?.username}</p>
              <a href="#profile-editor" className="mt-4 font-mono text-[0.6875rem] uppercase tracking-[0.12em] underline underline-offset-4">Edit profile <span aria-hidden="true">↗</span></a>
            </article>
            <article aria-labelledby="dashboard-page-heading" className="flex min-w-0 flex-col border border-rule bg-white/80 p-5 sm:p-6 lg:col-span-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="eyebrow">{featuredPage.status === 'published' ? 'Your page is live' : 'Your page is ready to publish'}</p>
                <span className="stamp">{featuredPage.status}</span>
              </div>
              <h2 id="dashboard-page-heading" className="mt-4 wrap-break-word font-display text-2xl font-medium sm:text-3xl">
                {featuredPage.title?.trim() || featuredPage.slug}
              </h2>
              <p className="mt-2 break-all font-mono text-xs text-ink-soft">{publicUrl?.host}{publicUrl?.pathname}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => void copyPublicLink()}>Copy</Button>
                {featuredPage.status === 'published' ? (
                  <a href={publicPagePath(featuredPage.slug)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center border border-rule px-4 font-mono text-[0.6875rem] uppercase tracking-[0.12em] underline underline-offset-4">
                    Open page <span className="ml-2" aria-hidden="true">↗</span>
                  </a>
                ) : <Link to={`/app/pages/${encodeURIComponent(featuredPage.id)}`} className="inline-flex min-h-11 items-center border border-rule px-4 font-mono text-[0.6875rem] uppercase tracking-[0.12em] underline underline-offset-4">Continue editing</Link>}
              </div>
              <div className="mt-auto grid grid-cols-3 border-t border-rule pt-4">
                {['Views', 'Clicks', 'CTR'].map((label) => (
                  <div key={label} className="border-r border-rule px-3 first:pl-0 last:border-r-0">
                    <p className="eyebrow">{label}</p><p className="mt-1 font-display text-lg text-ink-faint">Not collected</p>
                  </div>
                ))}
              </div>
              {featuredPage.status === 'draft' ? <p className="mt-3 text-xs text-ink-soft">This page is private until it is published.</p> : null}
            </article>
          </section>

          <section aria-labelledby="quick-actions-heading" className="mt-7">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="quick-actions-heading" className="font-display text-xl sm:text-2xl">Quick actions</h2>
              {canManagePages ? <Link to="/app/pages/new" className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] underline underline-offset-4">Create a page <span aria-hidden="true">↗</span></Link> : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Link to={`/app/pages/${encodeURIComponent(featuredPage.id)}#links-heading`} className="group flex min-h-16 items-center justify-between gap-3 border border-rule bg-white/80 px-4 py-3 text-sm transition-colors hover:border-ink"><span><span className="mr-3 font-mono text-lg" aria-hidden="true">＋</span>Add a link</span><span className="text-ink-faint transition-transform group-hover:translate-x-0.5" aria-hidden="true">↗</span></Link>
              <a href="#profile-editor" className="group flex min-h-16 items-center justify-between gap-3 border border-rule bg-white/80 px-4 py-3 text-sm transition-colors hover:border-ink"><span>Edit profile</span><span className="text-ink-faint transition-transform group-hover:translate-x-0.5" aria-hidden="true">↗</span></a>
              <Link to={`/app/pages/${encodeURIComponent(featuredPage.id)}#appearance-heading`} className="group flex min-h-16 items-center justify-between gap-3 border border-rule bg-white/80 px-4 py-3 text-sm transition-colors hover:border-ink"><span>Customize page</span><span className="text-ink-faint transition-transform group-hover:translate-x-0.5" aria-hidden="true">↗</span></Link>
              <Link to="/app/analytics" className="group flex min-h-16 items-center justify-between gap-3 border border-rule bg-white/80 px-4 py-3 text-sm transition-colors hover:border-ink"><span>Analytics</span><span className="text-ink-faint transition-transform group-hover:translate-x-0.5" aria-hidden="true">↗</span></Link>
            </div>
          </section>

          <section aria-labelledby="dashboard-links-heading" className="mt-7 border border-rule bg-white/80 p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink pb-3">
              <h2 id="dashboard-links-heading" className="font-display text-2xl">Your Links <span className="font-sans text-base text-ink-soft">({draft?.content.links.length ?? '…'})</span></h2>
              <Link to={`/app/pages/${encodeURIComponent(featuredPage.id)}#links-heading`} className="inline-flex min-h-10 items-center border border-ink px-4 font-mono text-[0.625rem] uppercase tracking-[0.12em]">＋ Add Link</Link>
            </div>
            {detailError ? <div className="mt-4"><ErrorNotice error={detailError} action="Load links again" onRetry={() => setDetailRetry((value) => value + 1)} /></div> : null}
            {!detailError && (detail === null || draft === null) ? <p role="status" className="py-6 text-sm text-ink-soft">Loading your links…</p> : null}
            {detail && draft && links.length === 0 ? <p className="py-6 text-sm text-ink-soft">No links on this page yet. Add the first destination to get started.</p> : null}
            {detail && draft && links.length > 0 ? (
              <ul className="divide-y divide-rule">
                {links.slice(0, 12).map((link, index) => (
                  <li key={link.id ?? `${link.url}-${index}`} className="flex flex-wrap items-center justify-between gap-3 py-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex flex-col items-center gap-1">
                        <span className="font-mono text-xs tracking-[-.2em] text-ink-faint" aria-hidden="true">⠿</span>
                        <button type="button" aria-label={`Move ${link.title} up`} disabled={index === 0 || linkActionPending} onClick={() => moveLink(index, -1)} className="font-mono text-xs disabled:opacity-30">↑</button>
                        <button type="button" aria-label={`Move ${link.title} down`} disabled={index === links.length - 1 || linkActionPending} onClick={() => moveLink(index, 1)} className="font-mono text-xs disabled:opacity-30">↓</button>
                      </div>
                      <div className="min-w-0">
                        <p className="wrap-break-word font-medium">{link.title}</p>
                        <p className="mt-1 truncate font-mono text-xs text-ink-soft">{link.url}</p>
                        {link.groupId ? <span className="mt-2 inline-block stamp">{draft.content.groups.find((group) => group.id === link.groupId)?.name ?? 'Group'}</span> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button type="button" aria-pressed={link.isVisible} aria-label={`${link.isVisible ? 'Hide' : 'Show'} ${link.title}`} disabled={linkActionPending} onClick={() => toggleLink(index)} className="font-mono text-[0.625rem] uppercase tracking-widest underline underline-offset-4">
                        {link.isVisible ? '◉ Visible' : '○ Hidden'}
                      </button>
                      <Link to={`/app/pages/${encodeURIComponent(featuredPage.id)}#links-heading`} className="font-mono text-[0.625rem] uppercase tracking-widest underline underline-offset-4">Edit</Link>
                      <button type="button" aria-label={`Remove ${link.title}`} disabled={linkActionPending} onClick={() => setRemovingLink(index)} className="font-mono text-[0.625rem] uppercase tracking-widest text-danger underline underline-offset-4">Remove</button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            {linkActionError ? <p role="alert" className="mt-4 border-l-2 border-danger pl-4 text-sm text-danger">{linkActionError} <Link to={`/app/pages/${encodeURIComponent(featuredPage.id)}#links-heading`} className="underline underline-offset-4">Open the editor</Link></p> : null}
            {linkActionStatus ? <p role="status" className="mt-4 text-sm text-ink-soft">{linkActionStatus}</p> : null}
            {links.length > 12 ? <Link to={`/app/pages/${encodeURIComponent(featuredPage.id)}#links-heading`} className="mt-4 inline-block font-mono text-[0.625rem] uppercase tracking-[0.12em] underline underline-offset-4">Load more in editor</Link> : null}
          </section>

          <section aria-labelledby="dashboard-profile-heading" className="mt-8 border border-rule bg-white/80 p-5 sm:p-6">
            <div className="mb-5 border-b border-rule pb-4">
              <p className="eyebrow">Account</p>
              <h2 id="dashboard-profile-heading" className="mt-1 font-display text-2xl">Profile &amp; social profiles</h2>
            </div>
            <ProfileScreen />
          </section>
          <ConfirmDialog
            open={removingLink !== null}
            title={`Remove “${removingLink === null ? '' : links[removingLink]?.title ?? 'this link'}”?`}
            confirmLabel="Remove link"
            tone="danger"
            pending={linkActionPending}
            onConfirm={removeLink}
            onCancel={() => setRemovingLink(null)}
          >
            This removes the destination from your saved draft. Publish the draft to update the public page.
          </ConfirmDialog>
        </>
      ) : null}

      {!featuredPage ? (
        <section aria-labelledby="dashboard-profile-heading" className="mt-8 border border-rule p-5 sm:p-6">
          <h2 id="dashboard-profile-heading" className="mb-5 font-display text-2xl">Profile &amp; social profiles</h2>
          <ProfileScreen />
        </section>
      ) : null}

      <section aria-label="Recent activity" className="mt-8 border border-rule p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-3">
          <h2 className="font-display text-2xl">Recent activity</h2>
          <span className="stamp text-ink-faint">Not available yet</span>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-ink-soft">
          Views, clicks, and contact submissions are not collected in this release, so there is no activity feed to show.
        </p>
      </section>

      <aside aria-label="Analytics availability" className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-rule pt-5">
        <div>
          <p className="eyebrow">Analytics</p>
          <p className="mt-1 text-sm text-ink-soft">Views and link clicks are not being tracked in this release.</p>
        </div>
        <Link to="/app/analytics" className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] underline underline-offset-4">See availability</Link>
      </aside>
    </section>
  )
}
