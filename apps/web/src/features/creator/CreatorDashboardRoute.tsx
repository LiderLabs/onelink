import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, CheckCircle, Circle, Copy, File, Link as LinkIcon, PencilSimple, Plus, ShareNetwork, SquaresFour } from '@phosphor-icons/react'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Splash } from '../../components/StatusScreens'
import { useSession } from '../../lib/session'
import type { OwnerPage, PageDraftState } from '../../lib/types'
import { getPageDraft, getPagePreview, getPublicPage, publicPagePath } from '../pages/api'
import { ProfileScreen } from '../profile/ProfileScreen'
import { CreatorPreview } from './CreatorPreview'
import { PublishedPageLink } from '../pages/PublishedPageLink'
import type { PageRenderModel } from '../pages/PageRenderer'
import { getSetupPages, hasCompletedSetup } from './setup-state'

export function CreatorDashboardRoute() {
  const { user, mustChangePassword } = useSession()
  const restricted = !user || mustChangePassword || user.status !== 'active' || user.impersonatedBy !== null
  const [pages, setPages] = useState<OwnerPage[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [retry, setRetry] = useState(0)
  const [draft, setDraft] = useState<PageDraftState | null>(null)
  const [preview, setPreview] = useState<PageRenderModel | null>(null)
  const [detailError, setDetailError] = useState<unknown>(null)
  const [detailRetry, setDetailRetry] = useState(0)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  useEffect(() => {
    document.title = 'Creator dashboard · OneLink'
    if (restricted) return
    let current = true
    setError(null); setPages(null)
    void getSetupPages().then(result => {
      if (!current) return
      setPages(result)
      setSelectedId(id => result.some(page => page.id === id) ? id : (result.find(page => page.status === 'published') ?? result[0])?.id ?? null)
    }).catch(cause => { if (current) setError(cause) })
    return () => { current = false }
  }, [user?.id, restricted, retry])
  const selected = pages?.find(page => page.id === selectedId)
  const live = selected?.status === 'published' && selected.moderationStatus === 'visible'
  useEffect(() => {
    if (!selected || restricted) return
    let current = true
    setPreview(null); setDraft(null); setDetailError(null)
    void Promise.all([getPageDraft(selected.id), live ? getPublicPage(selected.slug) : getPagePreview(selected.id)]).then(([saved, rendered]) => {
      if (current) { setDraft(saved.draft); setPreview(rendered.page) }
    }).catch(cause => { if (current) setDetailError(cause) })
    return () => { current = false }
  }, [selected?.id, live, restricted, detailRetry])
  const address = selected ? new URL(publicPagePath(selected.slug), window.location.origin).href : ''
  async function copy() {
    try { await navigator.clipboard.writeText(address); setCopyStatus('Page address copied.') }
    catch { setCopyStatus('Select and copy the page address to share it.') }
  }
  async function share() {
    try { if (navigator.share) await navigator.share({ title: selected?.title ?? user?.displayName, url: address }); else await copy() }
    catch (cause) { if (!(cause instanceof DOMException && cause.name === 'AbortError')) setCopyStatus('Could not open sharing. Copy your page address instead.') }
  }
  if (restricted) return <div className="creator-legacy"><ProfileScreen /></div>
  if (error) return <ErrorNotice error={error} action="Try again" onRetry={() => setRetry(value => value + 1)} />
  if (!pages) return <Splash label="Loading your creator dashboard" />
  const complete = hasCompletedSetup(pages)
  const editor = selected ? `/app/pages/${selected.id}` : '/app/onboarding'
  const manager = selected ? `/app/links?page=${selected.id}` : '/app/onboarding'
  const links = draft?.content.links ?? []
  const activeLinks = preview?.links.filter(link => link.isVisible && link.status === 'active').length ?? 0
  const checklist = [
    { title: 'Add profile details', description: 'Your name, bio, photo, and social handles', done: Boolean(user?.displayName && user.bio), href: '/app/settings/profile', action: 'Edit profile' },
    { title: 'Create your first link', description: 'Give visitors something to explore', done: links.length > 0, href: complete ? manager : '/app/onboarding', action: 'Add links' },
    { title: 'Choose a page theme', description: 'Make your profile recognizable', done: Boolean(selected?.accentColor), href: complete ? `${editor}#appearance-heading` : '/app/onboarding', action: 'Customize' },
    { title: 'Publish your page', description: 'Bring your page to your audience', done: Boolean(live), href: complete ? `${editor}?tab=publish` : '/app/onboarding', action: 'Continue setup' },
  ]
  return <>
    <header className="creator-heading"><div><p className="creator-eyebrow">Your dashboard</p><h1>{complete ? 'Welcome back' : 'Welcome'}, {user!.displayName.split(' ')[0]} <span aria-hidden="true">👋</span></h1><p>{complete ? 'Here’s what’s happening with your OneLink page today.' : 'Your creator space is ready. Let’s make your first page yours.'}</p></div><div className="creator-actions">{complete ? <><Link className="creator-button" to={editor}><PencilSimple size={18} />Edit Page</Link><Link className="creator-button creator-button-primary" to={`${manager}&add=1`}><Plus size={18} />Add Link</Link></> : <Link className="creator-button creator-button-primary" to="/app/onboarding">Continue setup<ArrowRight size={18} /></Link>}</div></header>
    {pages.length > 1 && <div className="creator-field mb-6" style={{ maxWidth: '24rem' }}><label htmlFor="dashboard-page">Your pages</label><select id="dashboard-page" value={selectedId ?? ''} onChange={event => { setSelectedId(event.target.value); setCopyStatus(null) }}>{pages.map(page => <option key={page.id} value={page.id}>{page.title || page.slug} · {page.status}</option>)}</select></div>}
    <section className="creator-card creator-address-card"><div><p className="creator-eyebrow">Your page address</p><h2>One link, all your important content.</h2><p>{live ? 'Share your personalized OneLink page with your audience. Customize it any time, then publish your updates.' : 'Finish setup and publish your page. Your draft stays private while you make it yours.'}</p></div><div className="creator-address-controls">{selected ? <><>{live ? <PublishedPageLink slug={selected.slug} className="creator-address">{address}</PublishedPageLink> : <span className="creator-address">{address}</span>}</><span className={`creator-badge ${live ? 'creator-badge-live' : 'creator-badge-private'}`}>{live ? 'Page live' : 'Not public'}</span>{live && <><button className="creator-button" onClick={() => void copy()}><Copy size={16} />Copy</button><button className="creator-button creator-button-subtle" onClick={() => void share()}><ShareNetwork size={16} />Share</button></>}</> : <Link className="creator-button creator-button-subtle" to="/app/onboarding">Claim your address<ArrowRight size={16} /></Link>}{copyStatus && <p role="status" className="creator-success">{copyStatus}</p>}</div></section>
    <section className="creator-metrics" aria-label="Your page at a glance">{[
      { title: 'Your pages', value: pages.length, note: 'Pages in your workspace', icon: SquaresFour },
      { title: 'Published pages', value: pages.filter(page => page.status === 'published').length, note: 'Saved publication status', icon: File },
      { title: 'Page links', value: draft ? links.length : '—', note: 'Links in the selected draft', icon: LinkIcon },
      { title: 'Visible active links', value: preview ? activeLinks : '—', note: live ? 'Links your visitors can open' : 'Links ready for your preview', icon: ArrowUpRight },
    ].map(metric => <div className="creator-card" key={metric.title}><div className="creator-metric-top"><span>{metric.title}</span><metric.icon size={20} weight="light" /></div><p className="creator-metric-value">{metric.value}</p><p className="creator-metric-note">{metric.note}</p></div>)}</section>
    <div className="creator-dashboard-grid"><div className="creator-stack">
      <section className="creator-card"><div className="creator-card-heading"><div><h2>{complete ? 'Your page activity' : 'Complete your setup'}</h2><p>{complete ? 'Your latest saved page details.' : 'Five small steps to your first public page.'}</p></div><span className="creator-badge">{checklist.filter(item => item.done).length} of 4 complete</span></div><progress className="creator-progress" max={4} value={checklist.filter(item => item.done).length} aria-label="Setup completion" /><ul className="creator-checklist">{checklist.map(item => <li key={item.title}>{item.done ? <CheckCircle size={22} /> : <Circle size={22} />}<div><strong>{item.title}</strong><p>{item.description}</p></div><Link className="creator-text-link" to={item.href}>{item.done ? 'Edit' : item.action}<ArrowUpRight size={14} /></Link></li>)}</ul>{selected && <p className="creator-notice mt-6"><InfoActivity /><span>Last page update: {new Date(selected.updatedAt).toLocaleString()}{draft?.unpublishedChanges ? '. You have unpublished draft changes.' : '.'}</span></p>}</section>
      <section className="creator-card"><div className="creator-card-heading"><div><h2>Your links</h2><p>{draft?.unpublishedChanges ? 'Your saved draft includes unpublished changes.' : 'All your important destinations, in order.'}</p></div><Link className="creator-text-link" to={complete ? manager : '/app/onboarding'}>Manage links<ArrowUpRight size={14} /></Link></div>{detailError ? <ErrorNotice error={detailError} action="Try again" onRetry={() => setDetailRetry(value => value + 1)} /> : selected && !draft ? <p className="creator-notice">Loading your links…</p> : links.length ? <div className="creator-list">{links.slice(0, 6).map((link, index) => <div className="creator-list-row" key={link.id ?? index}><LinkIcon size={20} className="shrink-0 text-cyan-400" /><div className="flex-1"><h3>{link.title}</h3><p>{link.url}</p></div><span className="creator-badge">{link.isVisible ? 'Visible' : 'Hidden'}</span></div>)}</div> : <div className="creator-empty"><LinkIcon size={28} /><h3>No links added yet</h3><p>Add your first link during setup and give your audience somewhere to go.</p><Link className="creator-button creator-button-subtle mt-5" to={complete ? `${manager}&add=1` : '/app/onboarding'}>Add your first link<Plus size={16} /></Link></div>}</section>
      {pages.length > 0 && <Link className="creator-text-link" to="/app/pages">Manage all pages<ArrowRight size={16} /></Link>}
    </div><section className="creator-card creator-dashboard-preview-card">{preview ? <><CreatorPreview page={preview} published={Boolean(live)} pendingReview={selected?.status === 'published' && selected.moderationStatus === 'under_review'} compact />{live && <PublishedPageLink slug={selected!.slug} className="creator-button creator-button-subtle creator-dashboard-preview-link">View public page<ArrowUpRight size={16} /></PublishedPageLink>}</> : <div className="creator-empty"><SquaresFour size={30} /><h3>{selected ? 'Your page preview' : 'Your page starts here'}</h3><p>{detailError ? 'The preview could not load. Try loading your page again.' : selected ? 'Loading your saved page…' : 'Claim your address, add your profile and links, then choose a look you love.'}</p>{!selected && <Link className="creator-button creator-button-primary mt-5" to="/app/onboarding">Start setup<ArrowRight size={16} /></Link>}</div>}</section></div>
  </>
}

function InfoActivity() { return <CheckCircle size={18} className="shrink-0" /> }
