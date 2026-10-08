import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../../components/Button'
import { EmptyState } from '../../components/EmptyState'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Icon } from '../../components/Icon'
import type { IconName } from '../../components/Icon'
import { IconButton } from '../../components/IconButton'
import { Panel } from '../../components/Panel'
import { Splash } from '../../components/StatusScreens'
import { cx, formatRelative, stagger } from '../../lib/css'
import { useSession } from '../../lib/session'
import type { OwnerPage, OwnerPageDetail } from '../../lib/types'
import { getPage, listMyPages, publicPagePath } from '../pages/api'
import { ProfileAvatar } from '../profile/ProfileAvatar'

// ============================================================================
// The dashboard.
//
// A read-only overview of the account and its page, not an editor. Editing moved
// to the merged editor, so this screen's job is orientation and one-click jumps:
// here is who you are, here is whether your page is live, here is what is on it,
// and here is the way into each part of the editor.
//
// The mockup shows a KPI strip and an activity feed. Nothing collects views,
// clicks or submissions, so those areas state that plainly instead of printing
// numbers — an invented "+4.2%" is worse than an honest dash.
// ============================================================================

interface QuickAction {
  to: string
  icon: IconName
  title: string
  description: string
  primary?: boolean
}

export function DashboardRoute() {
  const { user, platformName, mustChangePassword } = useSession()
  const navigate = useNavigate()
  const canManagePages = Boolean(user && user.status === 'active' && !mustChangePassword && user.impersonatedBy === null)

  const [pages, setPages] = useState<OwnerPage[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [retry, setRetry] = useState(0)
  const [detail, setDetail] = useState<OwnerPageDetail | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    document.title = `Dashboard · ${platformName}`
  }, [platformName])

  useEffect(() => {
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
  }, [canManagePages, retry])

  const firstPage = pages?.[0]
  const featuredPage = pages?.find((page) => page.status === 'published') ?? firstPage

  useEffect(() => {
    if (!featuredPage) {
      setDetail(null)
      return
    }
    let current = true
    setDetail(null)
    void getPage(featuredPage.id).then((result) => {
      if (current) setDetail(result)
    }).catch(() => { /* The overview degrades to page metadata when the detail read fails. */ })
    return () => { current = false }
  }, [featuredPage?.id])

  const publicUrl = featuredPage ? new URL(publicPagePath(featuredPage.slug), window.location.origin).href : null
  const editorPath = featuredPage ? `/app/editor/links?page=${encodeURIComponent(featuredPage.id)}` : '/app/editor'

  const copyLink = async () => {
    if (!publicUrl) return
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch { /* ignore */ }
  }

  if (error) return <ErrorNotice error={error} action="Try again" onRetry={() => setRetry((value) => value + 1)} />
  if (pages === null) return <Splash label="Loading your dashboard" />

  const links = detail?.links ?? []
  const quickActions: QuickAction[] = [
    { to: editorPath, icon: 'plus', title: 'Add Link', description: 'New card or embed', primary: true },
    { to: '/app/editor/profile', icon: 'profile', title: 'Edit Profile', description: 'Bio, photo & socials' },
    { to: featuredPage ? `/app/editor/design?page=${encodeURIComponent(featuredPage.id)}` : '/app/editor/design', icon: 'design', title: 'Customize', description: 'Theme, layout & accent' },
    { to: featuredPage ? `/app/editor/analytics?page=${encodeURIComponent(featuredPage.id)}` : '/app/editor/analytics', icon: 'analytics', title: 'Analytics', description: 'Audience breakdown' },
  ]

  return (
    <section className="mx-auto max-w-7xl">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-ink pb-6">
        <div className="min-w-0">
          <p className="eyebrow">Dashboard</p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight sm:text-4xl">
            Welcome, {user?.displayName || 'there'}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-soft">
            {featuredPage
              ? 'Here is how your page stands. Everything you edit lives in the editor.'
              : 'You have not made a page yet. Start one to give people somewhere to land.'}
          </p>
        </div>
        {featuredPage ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => void copyLink()}>
              <Icon name={copied ? 'check' : 'share'} size={16} /> {copied ? 'Copied' : 'Share'}
            </Button>
            <Button size="sm" disabled={!featuredPage.unpublishedChanges} onClick={() => navigate(editorPath)}>
              <Icon name="upload" size={16} /> Publish
            </Button>
          </div>
        ) : null}
      </div>

      <div className="mt-7 grid gap-5 lg:grid-cols-2">
        <Panel delay={0} className="flex items-center gap-5">
          <ProfileAvatar avatarKey={user?.avatarKey ?? null} displayName={user?.displayName ?? ''} className="h-16 w-16 rounded-full" />
          <div className="min-w-0">
            <h2 className="wrap-break-word font-display text-2xl font-medium">{user?.displayName || 'Your name'}</h2>
            <p className="mt-1 font-mono text-xs text-ink-soft">@{user?.username}</p>
            <Link to="/app/editor/profile" className="mt-3 inline-flex items-center gap-1 font-mono text-[0.6875rem] uppercase tracking-[0.12em] underline underline-offset-4">
              Edit profile <Icon name="arrow-up-right" size={14} />
            </Link>
          </div>
        </Panel>

        {featuredPage ? (
          <Panel delay={1} title={featuredPage.status === 'published' ? 'Your page is live' : 'Your page is a draft'}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 font-mono text-[0.6875rem] text-ink-soft">
                <span aria-hidden="true" className={featuredPage.status === 'published' ? 'h-1.5 w-1.5 rounded-full bg-ink' : 'h-1.5 w-1.5 rounded-full border border-ink-soft'} />
                {platformName.toLowerCase()}.me{publicPagePath(featuredPage.slug)}
              </span>
              <IconButton icon="copy" label="Copy public link" onClick={() => void copyLink()} />
              <a href={publicUrl ?? '#'} target="_blank" rel="noreferrer" className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] underline underline-offset-4">
                Open ↗
              </a>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 border-t border-rule pt-4">
              {([
                { key: 'Views', icon: 'eye' as IconName },
                { key: 'Clicks', icon: 'links' as IconName },
                { key: 'CTR', icon: 'analytics' as IconName },
              ]).map((metric) => (
                <div key={metric.key}>
                  <p className="eyebrow flex items-center gap-1.5 text-ink-soft">{metric.key} <Icon name={metric.icon} size={13} /></p>
                  <p className="mt-1 font-display text-xl text-ink-faint">—</p>
                  <p className="text-[0.6875rem] text-ink-faint">Not tracked</p>
                </div>
              ))}
            </div>
          </Panel>
        ) : (
          <EmptyState
            delay={1}
            title="No page yet"
            action={<Link to="/app/pages/new" className="inline-flex items-center gap-2 border border-ink bg-ink px-5 py-3 font-mono text-xs uppercase tracking-[0.18em] text-paper transition-colors hover:bg-paper hover:text-ink">Create a page</Link>}
          >
            A page holds your links and your public profile. Make one to begin.
          </EmptyState>
        )}
      </div>

      <section aria-labelledby="dashboard-quick-heading" className="mt-8">
        <h2 id="dashboard-quick-heading" className="font-display text-2xl font-medium">Quick actions</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {quickActions.map((action, index) => (
            <Link
              key={action.title}
              to={action.to}
              style={stagger(index)}
              className={cx(
                'reveal group flex min-h-16 items-center gap-4 border p-4 transition-colors',
                action.primary ? 'border-ink bg-ink text-paper hover:bg-paper hover:text-ink' : 'border-rule bg-white/80 hover:border-ink',
              )}
            >
              <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-md border', action.primary ? 'border-paper/40' : 'border-rule')}>
                <Icon name={action.icon} size={18} />
              </span>
              <span className="min-w-0">
                <span className="block font-medium">{action.title}</span>
                <span className={cx('block text-xs', action.primary ? 'text-paper/75' : 'text-ink-soft')}>{action.description}</span>
              </span>
              <span className="ml-auto shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5" aria-hidden="true"><Icon name="arrow-right" size={16} /></span>
            </Link>
          ))}
        </div>
      </section>

      <Panel
        delay={4}
        className="mt-8"
        eyebrow={`${links.length} total`}
        title={`Your Links (${links.length})`}
        description="A preview of the destinations on your page."
        action={
          <Link to={editorPath} className="inline-flex items-center gap-1 font-mono text-[0.6875rem] uppercase tracking-[0.12em] underline underline-offset-4">
            Manage <Icon name="arrow-up-right" size={14} />
          </Link>
        }
      >
        {links.length === 0 ? (
          <EmptyState
            title="No links yet"
            action={<Link to={editorPath} className="inline-flex items-center gap-2 border border-ink bg-ink px-5 py-3 font-mono text-xs uppercase tracking-[0.18em] text-paper transition-colors hover:bg-paper hover:text-ink">Add a link</Link>}
          >
            Add your first destination in the editor.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-rule border-y border-rule">
            {links.slice(0, 8).map((link) => (
              <li key={link.id} className="flex items-center gap-3 py-3">
                <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center border border-rule"><Icon name="links" size={16} /></span>
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{link.title}</span>
                  <p className="mt-0.5 truncate font-mono text-[0.6875rem] text-ink-soft">{link.url}</p>
                </div>
                {!link.isVisible ? <span className="stamp text-ink-faint">Hidden</span> : null}
                <span className="hidden shrink-0 text-[0.6875rem] text-ink-faint sm:block">{formatRelative(link.updatedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel delay={5} className="mt-8" eyebrow="Not available yet" title="Recent activity">
        <p className="text-sm leading-relaxed text-ink-soft">
          Views, clicks, and contact submissions are not collected in this release, so there is no activity feed to show.
        </p>
      </Panel>
    </section>
  )
}

