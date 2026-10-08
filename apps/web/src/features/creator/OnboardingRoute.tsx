import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Check, CheckCircle, Copy, Eye, EyeSlash, Info, Link as LinkIcon, List, PencilSimple, Plus, ShareNetwork, SquaresFour, Star, Trash } from '@phosphor-icons/react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Splash } from '../../components/StatusScreens'
import { ApiError, errorMessageFor } from '../../lib/api'
import { useDirtyForm, useUnsavedChanges } from '../../lib/dirty-form'
import { useSession } from '../../lib/session'
import type { OwnerPage, PageDraftContent, PageDraftState, PublicPageOwner, SessionUser, UpdateProfileInput } from '../../lib/types'
import { checkSlugAvailability, createPage, getPageDraft, getPagePreview, publicPagePath, publishPage, savePageDraft, slugReasonMessage } from '../pages/api'
import { QrCodeTools } from '../pages/QrCodeTools'
import { PublishedPageLink } from '../pages/PublishedPageLink'
import { ProfilePhotoEditor } from '../profile/ProfilePhotoEditor'
import { SocialsEditor } from '../profile/SocialsEditor'
import type { PreviewPhoto, PreviewSocials } from '../profile/ProfilePreview'
import '../profile/profile.css'
import { CreatorLinkDialog } from './CreatorLinkDialog'
import { CreatorPreview, draftModel } from './CreatorPreview'
import { getSetupPages, hasCompletedSetup, readSetupCursor, writeSetupCursor } from './setup-state'

const stepNames = ['Username', 'Profile', 'Links', 'Design', 'Publish']
const headings = ['Claim your page address', 'Let’s make it yours', 'Add your first links', 'Customize your design', 'You’re one click away.']
const introductions = ['Choose the address your audience will remember. Your account username is already yours.', 'Add a photo, write your bio, and connect your socials. You can change everything later.', 'Add the places you want people to visit. Your links will appear as buttons on your OneLink page.', 'Give your page a look that feels like you. Everything updates as you explore.', 'Take a final look at your profile, links, and design. When everything feels right, you’re ready to publish.']
function identityValues(user: SessionUser) { return { displayName: user.displayName, bio: user.bio ?? '', location: user.location ?? '', pronouns: user.pronouns ?? '' } }

export function OnboardingRoute() {
  const session = useSession()
  const user = session.user!
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [completed, setCompleted] = useState(false)
  const [step, setStep] = useState(1)
  const [page, setPage] = useState<OwnerPage | null>(null)
  const [draft, setDraft] = useState<PageDraftState | null>(null)
  const [content, setContent] = useState<PageDraftContent | null>(null)
  const [slug, setSlug] = useState(user.username)
  const [availability, setAvailability] = useState<{ available: boolean; message: string } | null>(null)
  const [availabilityBusy, setAvailabilityBusy] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photo, setPhoto] = useState<PreviewPhoto | null>(null)
  const [socials, setSocials] = useState<PreviewSocials>({ links: [], loading: false, unavailable: false })
  const [socialState, setSocialState] = useState({ pending: false, dirty: false })
  const [linkDialog, setLinkDialog] = useState<number | 'new' | null>(null)
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null)
  const [published, setPublished] = useState(false)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [reloadOpen, setReloadOpen] = useState(false)
  const baseline = useMemo(() => identityValues(user), [user])
  const identity = useDirtyForm(baseline)
  const values = identity.draft?.values ?? baseline
  const contentDirty = content !== null && draft !== null && JSON.stringify(content) !== JSON.stringify(draft.content)
  const guard = useUnsavedChanges(!published && (identity.dirty || contentDirty || socialState.dirty || photo !== null || pending || photoBusy || socialState.pending))
  const busy = pending || photoBusy || socialState.pending || photo !== null

  useEffect(() => {
    document.title = 'Create your page · OneLink'
    let current = true
    setLoading(true); setLoadError(null)
    void (async () => {
      const pages = await getSetupPages()
      if (!current) return
      if (hasCompletedSetup(pages)) { setCompleted(true); return }
      const cursor = readSetupCursor(user.id)
      const existing = pages.find(item => item.id === cursor?.pageId) ?? pages.find(item => item.status === 'draft')
      if (existing) {
        const [saved, preview] = await Promise.all([getPageDraft(existing.id), getPagePreview(existing.id)])
        if (!current) return
        setPage(existing); setDraft(saved.draft); setContent(saved.draft.content)
        setSocials({ loading: false, unavailable: false, links: preview.page.owner.socials.map((social, index) => ({ ...social, id: `saved-social-${index}`, isVisible: true })) })
        const now = Date.now()
        const readyToReview = saved.draft.content.links.some(link => link.isVisible && (link.startsAt === null || link.startsAt <= now) && (link.endsAt === null || link.endsAt > now))
        // A different browser has no cursor. Resume from saved content there.
        setStep(cursor?.pageId === existing.id ? cursor.step : readyToReview ? 5 : 2)
      }
    })().catch(cause => { if (current) setLoadError(errorMessageFor(cause)) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [user.id, retry])

  useEffect(() => {
    if (step !== 1 || loading) return
    let current = true
    setAvailability(null); setAvailabilityBusy(Boolean(slug.trim()))
    if (!slug.trim()) return
    const timer = window.setTimeout(() => {
      void checkSlugAvailability(slug.trim()).then(result => { if (current) setAvailability({ available: result.available, message: slugReasonMessage(result.reason) }) })
        .catch(() => { if (current) setAvailability({ available: false, message: 'Could not check this address. Try claiming it to check again.' }) })
        .finally(() => { if (current) setAvailabilityBusy(false) })
    }, 250)
    return () => { current = false; window.clearTimeout(timer) }
  }, [slug, step, loading])

  const owner: PublicPageOwner = { username: user.username, ...values, displayName: values.displayName.trim() || 'Your name', bio: values.bio || null, location: values.location || null, pronouns: values.pronouns || null,
    avatarUrl: user.avatarUrl, socials: socials.links.filter(link => link.isVisible).map(({ platform, url, position }) => ({ platform, url, position })) }
  const model = page && content ? draftModel(page.slug, content, owner) : null
  const publicUrl = page ? new URL(publicPagePath(page.slug), window.location.origin).href : ''
  const pageLive = page?.status === 'published' && page.moderationStatus === 'visible'
  const visibleLinks = model?.links.filter(link => link.isVisible && link.status === 'active') ?? []

  function go(next: number) {
    if (page) writeSetupCursor(user.id, page.id, next)
    setStep(next); setError(null); setNotice(null)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
  async function store(next: PageDraftContent) {
    if (!page || !draft) throw new Error('Your page is still loading. Try again.')
    let saved
    try { saved = await savePageDraft(page.id, next, draft.updatedAt) }
    catch (cause) { if (cause instanceof ApiError && ['CONFLICT', 'PRECONDITION_FAILED'].includes(cause.code)) setConflict(true); throw cause }
    setDraft(saved.draft); setContent(saved.draft.content)
    return saved.draft
  }
  async function saveIdentity() {
    if (!identity.draft || !identity.dirty) return
    const limits = { displayName: 50, bio: 160, location: 100, pronouns: 40 }
    if (identity.changedKeys.some(key => values[key].trim().length > limits[key] || (key === 'displayName' && !values[key].trim()))) {
      throw new Error('Use a display name of 1–50 characters, a bio of up to 160, location up to 100, and pronouns up to 40.')
    }
    const payload: UpdateProfileInput = { expected: {} }
    for (const key of identity.changedKeys) {
      const previous = identity.draft.original[key]
      if (key === 'displayName') { payload.displayName = values.displayName.trim(); payload.expected!.displayName = previous }
      else { payload[key] = values[key].trim() || null; payload.expected![key] = previous || null }
    }
    let saved
    try { saved = await session.updateProfile(payload) }
    catch (cause) { if (cause instanceof ApiError && ['CONFLICT', 'PRECONDITION_FAILED'].includes(cause.code)) setConflict(true); throw cause }
    identity.reset(identityValues(saved))
  }
  async function claim(event: FormEvent) {
    event.preventDefault(); setPending(true); setError(null)
    let claimed: OwnerPage | null = null
    try {
      const available = await checkSlugAvailability(slug.trim())
      if (!available.available) throw new Error(slugReasonMessage(available.reason))
      claimed = await createPage({ slug: slug.trim(), theme: 'dark', layout: 'list', accentColor: '#00d8ef', showBranding: true })
      // Remember the successfully claimed page even if the following read fails.
      setPage(claimed); writeSetupCursor(user.id, claimed.id, 2)
      const saved = await getPageDraft(claimed.id)
      setDraft(saved.draft); setContent(saved.draft.content); setStep(2)
    } catch (cause) {
      setError(cause instanceof ApiError ? errorMessageFor(cause) : cause instanceof Error ? cause.message : errorMessageFor(cause))
      if (claimed) setStep(2)
      else if (cause instanceof ApiError && ['NETWORK', 'UNKNOWN'].includes(cause.code)) setRetry(value => value + 1)
    }
    finally { setPending(false) }
  }
  async function save(nextStep?: number) {
    setError(null); setNotice(null)
    if (socialState.dirty) { setError('Save or cancel your social profile edits before continuing. Clear an unfinished new social URL to cancel it.'); return }
    setPending(true)
    try {
      await saveIdentity()
      if (content && contentDirty) await store(content)
      if (nextStep) go(nextStep)
      else setNotice('Draft saved. Your page is still private.')
    } catch (cause) { setError(cause instanceof Error && !(cause as { code?: string }).code ? cause.message : errorMessageFor(cause)) }
    finally { setPending(false) }
  }
  async function mutateLinks(links: PageDraftContent['links']) {
    if (!content) return
    setPending(true); setError(null)
    try { await store({ ...content, links }) }
    catch (cause) { setError(errorMessageFor(cause)); throw cause }
    finally { setPending(false) }
  }
  async function move(index: number, direction: number) {
    if (!content) return
    const links = [...content.links]; const destination = index + direction
    if (destination < 0 || destination >= links.length) return
    const source = links[index], target = links[destination]
    if (!source || !target) return
    links[index] = target; links[destination] = source
    await mutateLinks(links)
  }
  async function publish() {
    if (!page || !content) return
    setError(null)
    if (!values.displayName.trim() || visibleLinks.length === 0) { setError('Add your display name and at least one visible, active link before publishing.'); return }
    setPending(true)
    try {
      await saveIdentity()
      const approved = contentDirty ? await store(content) : draft
      const latest = await getPageDraft(page.id)
      if (latest.draft.updatedAt !== approved?.updatedAt) {
        setConflict(true)
        throw new ApiError(409, 'CONFLICT', 'Your draft changed in another tab. Load the latest saved version and review it before publishing.')
      }
      const result = await publishPage(page.id)
      setPage(result); setPublished(true)
      window.scrollTo({ top: 0, behavior: 'instant' })
    } catch (cause) { setError(errorMessageFor(cause)) }
    finally { setPending(false) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(publicUrl); setCopyMessage('Page address copied.') }
    catch { setCopyMessage('Copy the page address above to share it.') }
  }
  async function share() {
    try { if (navigator.share) await navigator.share({ title: `${values.displayName} on OneLink`, url: publicUrl }); else await copy() }
    catch (cause) { if (!(cause instanceof DOMException && cause.name === 'AbortError')) setCopyMessage('Could not open sharing. Copy your page address instead.') }
  }
  async function reloadSaved() {
    if (!page) return
    setPending(true)
    try {
      const [saved, refreshed] = await Promise.all([getPageDraft(page.id), session.refreshProfile()])
      setDraft(saved.draft); setContent(saved.draft.content); identity.reset(identityValues(refreshed))
      setConflict(false); setReloadOpen(false); setError(null); setNotice('Latest saved version loaded.')
    } catch (cause) { setError(errorMessageFor(cause)); setReloadOpen(false) }
    finally { setPending(false) }
  }

  if (completed) return <Navigate to="/app/dashboard" replace />
  if (loading) return <Splash label="Opening your page setup" />
  if (loadError) return <div className="creator-error" role="alert">{loadError}<button className="creator-button ml-4" onClick={() => setRetry(value => value + 1)}>Try again</button></div>

  return <>
    {published ? <>
      <section className="creator-success-hero"><span className={`creator-badge ${pageLive ? 'creator-badge-live' : 'creator-badge-private'}`}><Check size={14} />{pageLive ? 'Page published' : 'Awaiting review'}</span><p className="creator-eyebrow">Your OneLink journey starts here</p><h1>{pageLive ? 'Looking good. You’re ready to share.' : 'Your page is awaiting review.'}</h1><p>{pageLive ? 'Your page is live. Share your address and give your audience one place to find you.' : 'Your changes are saved. Your page will be available to visitors once its review is complete.'}</p><Link className="creator-button creator-button-primary" to="/app/dashboard">Go to dashboard<ArrowRight size={18} /></Link></section>
      <div className="creator-onboarding-grid"><div className="creator-stack"><section className="creator-card"><div className="creator-card-heading"><div><h2>Your page address</h2><p>One link for everything you create.</p></div><ShareNetwork size={22} /></div><p className="creator-address">{publicUrl}</p>{pageLive ? <div className="creator-actions mt-5"><PublishedPageLink slug={page!.slug} className="creator-button">Open my page<ArrowRight size={16} /></PublishedPageLink><button className="creator-button creator-button-primary" onClick={() => void copy()}><Copy size={16} />Copy address</button><button className="creator-button" onClick={() => void share()}>Share</button></div> : <p className="creator-notice mt-5">Public sharing becomes available once the page review is complete.</p>}<p className="creator-success mt-3" role="status">{copyMessage}</p></section><section className="creator-card"><h2 className="mb-5">What’s next?</h2><div className="creator-list"><Link className="creator-list-row" to={`/app/pages/${page!.id}`}><span>Polish your page</span><ArrowRight size={18} /></Link><Link className="creator-list-row" to="/app/profile"><span>Update your profile</span><ArrowRight size={18} /></Link></div></section></div><section className="creator-card">{pageLive ? <div className="creator-legacy"><h2 className="mb-5">QR code for your page</h2><QrCodeTools url={publicUrl} name={page!.slug} /></div> : <CreatorPreview page={model!} pendingReview />}</section></div>
    </> : <>
      <header className="creator-heading"><div><p className="creator-eyebrow">{step === 1 ? 'Your own corner of the internet' : 'Welcome to your space'}</p><h1>{headings[step - 1]}</h1><p>{introductions[step - 1]}</p></div><span className="creator-badge">Step {step} of 5</span></header>
      <nav className="creator-steps" aria-label="Page setup progress">{stepNames.map((name, index) => <button type="button" key={name} className={`creator-step ${index + 1 < step ? 'is-complete' : ''}`} aria-current={step === index + 1 ? 'step' : undefined} disabled={busy || index === 0 || index + 1 >= step} onClick={() => void save(index + 1)}><span className="creator-step-number">{index + 1 < step ? <Check size={16} /> : index + 1}</span><span><strong>{name}</strong><small>{index + 1 < step ? 'Completed' : index + 1 === step ? 'You’re here' : 'Next up'}</small></span></button>)}</nav>
      {error && <div role="alert" className="creator-error">{error}{conflict && <button className="creator-button ml-4" disabled={busy} onClick={() => setReloadOpen(true)}>Load latest saved version</button>}</div>}
      {notice && <p role="status" className="creator-success mb-5">{notice}</p>}
      {step === 1 ? <section className="creator-card" style={{ maxWidth: '43rem', marginInline: 'auto' }}><form onSubmit={event => void claim(event)} className="creator-form-grid"><div className="creator-card-heading"><div><h2>Your OneLink address</h2><p>Claiming an address creates a private page draft.</p></div><LinkIcon size={24} /></div><div className="creator-field"><label htmlFor="creator-slug">Page username</label><input id="creator-slug" autoComplete="off" required maxLength={64} value={slug} onChange={event => setSlug(event.target.value)} disabled={pending} /><p className="creator-address">{window.location.host}{publicPagePath(slug.trim() || 'yourname')}</p><p aria-live="polite" className={availability?.available ? 'creator-success' : undefined}>{availabilityBusy ? 'Checking availability…' : availability?.message}</p></div><p className="creator-notice"><Info size={18} className="shrink-0" />Your page won’t be public until you finish setup and publish.</p><button className="creator-button creator-button-primary" disabled={pending || !slug.trim()}>{pending ? 'Claiming…' : 'Claim & continue'}<ArrowRight size={18} /></button></form></section> : content && model ? <>
        <div className="creator-onboarding-grid"><div className="creator-stack">
          {step === 2 && <>
            <section className="creator-card"><div className="creator-card-heading"><div><h2>Your profile</h2><p>Your first impression. Make it count.</p></div><span className="creator-badge">Basic details</span></div>
              <div className="creator-onboarding-photo creator-legacy"><ProfilePhotoEditor user={user} readable writable={!pending} onBusyChange={setPhotoBusy} onPreviewChange={setPhoto} /></div>
              <div className="creator-form-grid mt-6"><div className="creator-field"><label htmlFor="setup-name">Display name <span>{values.displayName.length}/50</span></label><input id="setup-name" required maxLength={Math.max(50, baseline.displayName.length)} value={values.displayName} placeholder="What should people call you?" onChange={event => identity.setValue('displayName', event.target.value)} disabled={busy} /></div><div className="creator-field"><label htmlFor="setup-bio">Bio <span>{values.bio.length}/160</span></label><textarea id="setup-bio" maxLength={Math.max(160, baseline.bio.length)} value={values.bio} placeholder="A sentence or two about who you are and what you create…" onChange={event => identity.setValue('bio', event.target.value)} disabled={busy} /><p>Keep it short and memorable. You’ll see changes in the preview instantly.</p></div><div className="creator-field-pair"><div className="creator-field"><label htmlFor="setup-location">Location <span>Optional</span></label><input id="setup-location" maxLength={100} value={values.location} placeholder="e.g. Accra, Ghana" onChange={event => identity.setValue('location', event.target.value)} disabled={busy} /></div><div className="creator-field"><label htmlFor="setup-pronouns">Pronouns <span>Optional</span></label><input id="setup-pronouns" maxLength={40} value={values.pronouns} placeholder="e.g. she/her" onChange={event => identity.setValue('pronouns', event.target.value)} disabled={busy} /></div></div></div>
            </section>
            <section className="creator-card"><div className="creator-card-heading"><div><h2>Social profiles</h2><p>Make it easy for your audience to connect with you.</p></div><span className="creator-badge">Optional</span></div><div className="creator-onboarding-socials creator-legacy"><SocialsEditor readable writable={!pending && !photoBusy} blockedReason="" onPreviewChange={setSocials} onStateChange={setSocialState} /></div></section>
          </>}
          {step === 3 && <>
            <section className="creator-card"><div className="creator-card-heading"><div><h2>Your links</h2><p>Start with your website, portfolio, store, or something you love.</p></div><span className="creator-badge">Step 03</span></div><p className="creator-notice mb-4"><Star size={22} className="shrink-0" /><span><strong>Start with 1–3 of your best links</strong><br />Give visitors a few clear places to go. You can add more later.</span></p><div className="creator-list-row mb-5"><div><h3>Add a destination</h3><p>Paste a link and make it yours.</p></div><button className="creator-button creator-button-primary" onClick={() => setLinkDialog('new')} disabled={busy}><Plus size={16} />Add Link</button></div><p className="text-xs mb-3">Added links ({content.links.length})</p>
              {!content.links.length ? <div className="creator-empty"><LinkIcon size={28} /><h3>No links added yet</h3><p>Your first link is one click away. Try your portfolio, shop, blog, or favorite project.</p></div> : <div className="creator-list">{content.links.map((link, index) => <div key={link.id ?? index} className="creator-list-row"><div><h3>{link.title}</h3><p>{link.url}</p><span className={`creator-badge mt-2 ${link.isVisible ? '' : 'creator-badge-private'}`}>{link.isVisible ? 'Visible' : 'Hidden'}{(model.links[index]?.status ?? 'active') !== 'active' ? ` · ${(model.links[index]?.status ?? 'active')}` : ''}</span></div><div className="creator-actions"><button className="creator-icon-button" aria-label={`Move ${link.title} up`} disabled={busy || index === 0} onClick={() => void move(index, -1).catch(() => {})}><ArrowUp size={16} /></button><button className="creator-icon-button" aria-label={`Move ${link.title} down`} disabled={busy || index === content.links.length - 1} onClick={() => void move(index, 1).catch(() => {})}><ArrowDown size={16} /></button><button className="creator-icon-button" aria-label={`${link.isVisible ? 'Hide' : 'Show'} ${link.title}`} disabled={busy} onClick={() => void mutateLinks(content.links.map((row, position) => position === index ? { ...row, isVisible: !row.isVisible } : row)).catch(() => {})}>{link.isVisible ? <Eye size={16} /> : <EyeSlash size={16} />}</button><button className="creator-icon-button" aria-label={`Edit ${link.title}`} disabled={busy} onClick={() => setLinkDialog(index)}><PencilSimple size={16} /></button><button className="creator-icon-button" aria-label={`Remove ${link.title}`} disabled={busy} onClick={() => setDeleteIndex(index)}><Trash size={16} /></button></div></div>)}</div>}
            </section><p className="creator-notice"><Info size={18} className="shrink-0" />Your draft is private. Add, hide, edit, remove, and rearrange links before publishing.</p>
          </>}
          {step === 4 && <>
            <div className="creator-design-grid"><section className="creator-card"><div className="creator-card-heading"><div><h2>Theme presets</h2><p>Start with a look you love.</p></div></div><div className="creator-theme-grid">{([{ name: 'Neon', theme: 'dark', color: '#00d8ef' }, { name: 'Minimal', theme: 'light', color: '#171715' }, { name: 'Dark', theme: 'dark', color: '#8b9bff' }, { name: 'Clean', theme: 'light', color: '#008a9b' }] as const).map(theme => <button key={theme.name} className="creator-theme-option" disabled={busy} aria-pressed={content.page.theme === theme.theme && content.page.accentColor === theme.color} onClick={() => setContent({ ...content, page: { ...content.page, theme: theme.theme, accentColor: theme.color } })}><span className={`creator-theme-thumbnail ${theme.theme === 'light' ? 'is-light' : ''}`}><i className="creator-theme-avatar" /><i className="creator-theme-line" /><i className="creator-theme-line" /><i className="creator-theme-line" /></span>{theme.name}</button>)}</div></section>
              <section className="creator-card"><div className="creator-card-heading"><div><h2>Accent color</h2><p>A highlight that feels like you.</p></div></div><div className="creator-colors">{['#00d8ef', '#3b82f6', '#a855f7', '#ec4899', '#fb923c', '#22c99a'].map(color => <button key={color} className="creator-color-swatch" style={{ '--swatch': color } as CSSProperties} aria-label={`Accent ${color}`} aria-pressed={content.page.accentColor === color} disabled={busy} onClick={() => setContent({ ...content, page: { ...content.page, accentColor: color } })} />)}<label className="creator-text-link">Custom<input aria-label="Custom accent color" type="color" className="creator-color-input" value={content.page.accentColor ?? '#00d8ef'} disabled={busy} onChange={event => setContent({ ...content, page: { ...content.page, accentColor: event.target.value } })} /></label></div><p className="text-xs text-ink-soft mt-5">Current accent: {content.page.accentColor}</p></section>
              <section className="creator-card"><div className="creator-card-heading"><div><h2>Layout options</h2><p>Choose how your links are displayed.</p></div></div><div className="creator-layout-options"><button disabled={busy} aria-pressed={content.page.layout === 'list'} onClick={() => setContent({ ...content, page: { ...content.page, layout: 'list' } })}><List size={28} />Center stack</button><button disabled={busy} aria-pressed={content.page.layout === 'grid'} onClick={() => setContent({ ...content, page: { ...content.page, layout: 'grid' } })}><SquaresFour size={28} />Grid</button></div></section>
              <section className="creator-card"><div className="creator-card-heading"><div><h2>Page branding</h2><p>A familiar signature for your page.</p></div></div><label className="creator-checkbox"><span>Made with OneLink</span><input type="checkbox" checked={content.page.showBranding} disabled={busy} onChange={event => setContent({ ...content, page: { ...content.page, showBranding: event.target.checked } })} /></label></section>
            </div><section className="creator-card creator-form-grid"><div className="creator-card-heading"><div><h2>Page introduction</h2><p>Optional text for this page. Your profile appears when these are empty.</p></div></div><div className="creator-field"><label htmlFor="setup-page-title">Page title <span>Optional · 120 characters</span></label><input id="setup-page-title" maxLength={120} placeholder={values.displayName} value={content.page.title ?? ''} disabled={busy} onChange={event => setContent({ ...content, page: { ...content.page, title: event.target.value || null } })} /></div><div className="creator-field"><label htmlFor="setup-page-bio">Page description <span>Optional · 500 characters</span></label><textarea id="setup-page-bio" maxLength={500} value={content.page.bio ?? ''} disabled={busy} onChange={event => setContent({ ...content, page: { ...content.page, bio: event.target.value || null } })} /></div></section>
          </>}
          {step === 5 && <>
            <section className="creator-card"><div className="creator-card-heading"><div><h2>Your OneLink page</h2><p>The address your audience will recognize.</p></div><LinkIcon size={24} /></div><p className="creator-address">{publicUrl}</p><p className="creator-notice mt-4"><Info size={18} className="shrink-0" />This is your private draft. Publishing will make this page publicly accessible.</p></section>
            <section className="creator-card"><div className="creator-card-heading"><div><h2>Ready to publish?</h2><p>Check the essentials before going live.</p></div></div><div className="creator-list">{[{ title: 'Profile information', detail: values.displayName, ready: Boolean(values.displayName.trim()), target: 2 }, { title: 'At least one active link', detail: `${visibleLinks.length} visible, active links`, ready: visibleLinks.length > 0, target: 3 }, { title: 'Page design', detail: `${content.page.theme} theme · ${content.page.layout} layout`, ready: true, target: 4 }].map(item => <div className="creator-list-row" key={item.title}>{item.ready ? <CheckCircle size={24} color="#43dba9" className="shrink-0" /> : <Info size={24} className="shrink-0" />}<div className="flex-1"><h3>{item.title}</h3><p>{item.detail}</p></div><button className="creator-text-link" disabled={busy} onClick={() => go(item.target)}>Edit<ArrowRight size={14} /></button></div>)}</div></section>
            <section className="creator-card"><div className="creator-card-heading"><div><h2>Links that visitors will see</h2><p>Check order and visibility before publishing.</p></div></div><div className="creator-list">{content.links.map((link, index) => <div key={link.id ?? index} className="creator-list-row"><LinkIcon size={20} className="shrink-0" /><div className="flex-1"><h3>{link.title}</h3><p>{link.url}</p></div><span className="creator-badge">{!link.isVisible ? 'Hidden' : (model.links[index]?.status ?? 'active') === 'active' ? 'Visible' : (model.links[index]?.status ?? 'active')}</span></div>)}</div>{content.links.length === 0 && <p className="creator-notice">Add a link before publishing your page.</p>}</section>
          </>}
        </div><CreatorPreview page={model} photo={photo} /></div>
        <footer className="creator-step-footer"><p><Info size={16} />Your page stays private until you publish.</p><div className="creator-actions">{step > 2 && <button className="creator-button" disabled={busy} onClick={() => void save(step - 1)}><ArrowLeft size={16} />Back</button>}<button className="creator-button" disabled={busy} onClick={() => void save()}>Save draft</button>{step < 5 ? <button className="creator-button creator-button-primary" disabled={busy} onClick={() => void save(step + 1)}>{pending ? 'Saving…' : 'Save & continue'}<ArrowRight size={18} /></button> : <button className="creator-button creator-button-primary" disabled={busy || visibleLinks.length === 0} onClick={() => void publish()}>{pending ? 'Publishing…' : 'Publish my page'}<ArrowRight size={18} /></button>}</div></footer>
      </> : <div className="creator-error">Your address was claimed, but its draft could not load.<button className="creator-button ml-4" onClick={() => setRetry(value => value + 1)}>Load draft</button></div>}
    </>}
    {linkDialog !== null && content && <CreatorLinkDialog initial={linkDialog === 'new' ? undefined : content.links[linkDialog]} onClose={() => setLinkDialog(null)} onSave={async link => { const links = [...content.links]; if (linkDialog === 'new') links.push(link); else links[linkDialog] = link; await mutateLinks(links) }} />}
    <ConfirmDialog open={deleteIndex !== null} title="Remove this link?" confirmLabel="Remove link" pending={pending} onCancel={() => setDeleteIndex(null)} onConfirm={() => { if (content && deleteIndex !== null) void mutateLinks(content.links.filter((_, index) => index !== deleteIndex)).then(() => setDeleteIndex(null)).catch(() => {}) }}>This removes the link from your private draft. You can add it again later.</ConfirmDialog>
    <ConfirmDialog open={guard.blocked} title="Leave without saving?" confirmLabel="Leave setup" cancelLabel="Keep editing" pending={pending || photoBusy || socialState.pending} onConfirm={guard.proceed} onCancel={guard.stay}>You have unsaved edits. Saved profile details and page drafts will be here when you return.</ConfirmDialog>
    <ConfirmDialog open={reloadOpen} title="Load the latest saved version?" confirmLabel="Load latest version" pending={pending} onConfirm={() => void reloadSaved()} onCancel={() => setReloadOpen(false)}>This replaces your unsaved profile and design edits with the latest saved values. Save or copy anything you want to keep first.</ConfirmDialog>
  </>
}

