import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Check, Copy, DownloadSimple, FacebookLogo, Info, LinkedinLogo, LinkSimple, LockSimple, Palette, QrCode, ShareNetwork, WhatsappLogo, X, XLogo } from '@phosphor-icons/react'
import QRCode from 'qrcode'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Splash } from '../../components/StatusScreens'
import { errorMessageFor } from '../../lib/api'
import { useSession } from '../../lib/session'
import type { OwnerPage, PublicPageDto } from '../../lib/types'
import { getPagePreview, getPublicPage, publicPagePath } from '../pages/api'
import { PageRenderer } from '../pages/PageRenderer'
import { getSetupPages } from './setup-state'
import './creator-share.css'

const patternColors = [
  { name: 'Charcoal', value: '#0c0e14' }, { name: 'Deep teal', value: '#154b50' },
  { name: 'Midnight blue', value: '#253973' }, { name: 'Plum', value: '#4d2758' },
]
const backgroundColors = [
  { name: 'White', value: '#ffffff' }, { name: 'Ice', value: '#f0fbff' },
  { name: 'Lavender', value: '#f5f0ff' }, { name: 'Cream', value: '#fffaeb' },
]
function luminance(hex: string) {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
  }
  return channel(1) * .2126 + channel(3) * .7152 + channel(5) * .0722
}
function scanSafe(dark: string, light: string) {
  if (![dark, light].every(value => /^#[\da-f]{6}$/i.test(value))) return false
  return (luminance(light) + .05) / (luminance(dark) + .05) >= 7
}
function badgeHeight(size: number) { return Math.round(size * .12) }
async function makeSvg(url: string, size: number, dark: string, light: string, badge: boolean) {
  const svg = await QRCode.toString(url, { type: 'svg', width: size, margin: 4, errorCorrectionLevel: 'M', color: { dark, light } })
  if (!badge) return svg
  const extra = badgeHeight(size)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size + extra}" viewBox="0 0 ${size} ${size + extra}"><rect width="${size}" height="${size + extra}" fill="${light}"/>${svg}<text x="${size / 2}" y="${size + extra * .58}" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="${Math.round(size * .035)}" font-weight="600" fill="${dark}">OneLink</text></svg>`
}
function download(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

export function CreatorShareRoute() {
  const { user, mustChangePassword } = useSession()
  const restricted = !user || mustChangePassword || user.status !== 'active' || user.impersonatedBy !== null
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedId = searchParams.get('page')
  const [pages, setPages] = useState<OwnerPage[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(requestedId)
  const [listError, setListError] = useState<unknown>(null)
  const [retry, setRetry] = useState(0)
  const [verified, setVerified] = useState<string | null>(null)
  const [publicError, setPublicError] = useState(false)
  const [publicRetry, setPublicRetry] = useState(0)
  const [dark, setDark] = useState('#0c0e14')
  const [light, setLight] = useState('#ffffff')
  const [size, setSize] = useState(1024)
  const [badge, setBadge] = useState(true)
  const [qr, setQr] = useState<{ url: string; dark: string; light: string; badge: boolean; svg: string } | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const previewRequest = useRef(0)
  const [preview, setPreview] = useState<PublicPageDto | null>(null)
  const [previewError, setPreviewError] = useState<unknown>(null)

  useEffect(() => {
    document.title = 'Share & QR · OneLink'
    if (restricted) return
    let current = true
    setListError(null)
    setPages(null)
    void getSetupPages().then(result => {
      if (!current) return
      setPages(result)
      setSelectedId(id => result.some(page => page.id === (requestedId ?? id)) ? requestedId ?? id :
        (result.find(page => page.status === 'published' && page.moderationStatus === 'visible') ?? result[0])?.id ?? null)
    }).catch(error => { if (current) setListError(error) })
    return () => { current = false }
  }, [user?.id, restricted, retry])
  useEffect(() => {
    if (requestedId && pages?.some(page => page.id === requestedId)) setSelectedId(requestedId)
  }, [requestedId, pages])
  const selected = pages?.find(page => page.id === selectedId)
  const published = selected?.status === 'published' && selected.moderationStatus === 'visible'
  const address = selected ? new URL(publicPagePath(selected.slug), window.location.origin).href : ''
  const verifiedKey = selected ? `${selected.id}:${selected.slug}` : ''
  const live = Boolean(published && verified === verifiedKey)
  const safeColors = scanSafe(dark, light)
  const qrReady = qr?.url === address && qr.dark === dark && qr.light === light && qr.badge === badge
  const canDownload = live && safeColors && qrReady && !exporting

  useEffect(() => {
    let current = true
    setVerified(null)
    setPublicError(false)
    setNotice(null)
    previewRequest.current++
    dialog.current?.close()
    if (published && selected && !restricted) {
      void getPublicPage(selected.slug).then(result => {
        if (!current) return
        if (result.page.slug === selected.slug) setVerified(verifiedKey)
        else setPublicError(true)
      }).catch(() => { if (current) setPublicError(true) })
    }
    return () => { current = false }
  }, [selected?.id, selected?.slug, published, restricted, publicRetry])

  useEffect(() => {
    let current = true
    setQr(null)
    setQrError(null)
    if (address && safeColors) {
      void makeSvg(address, 320, dark, light, badge).then(svg => {
        if (current) setQr({ url: address, dark, light, badge, svg })
      }).catch(() => { if (current) setQrError('This page address could not be encoded. Try again.') })
    }
    return () => { current = false }
  }, [address, dark, light, safeColors, badge])

  async function copyAddress() {
    if (!selected) return
    try {
      await navigator.clipboard.writeText(address)
      setNotice(live ? 'Page address copied.' : 'Planned address copied. Your page is not public yet.')
    } catch {
      const input = document.getElementById('share-page-address') as HTMLInputElement | null
      input?.focus()
      input?.select()
      setNotice('The address is selected. Use your device’s copy command.')
    }
  }
  async function sharePage() {
    if (!live) return
    if (!navigator.share) { await copyAddress(); return }
    try { await navigator.share({ title: selected?.title || user?.displayName || 'My OneLink page', url: address }) }
    catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setNotice('Sharing could not open. Copy the page address to share it.')
    }
  }
  async function openPreview() {
    if (!selected || restricted) return
    const requestId = ++previewRequest.current
    setPreview(null)
    setPreviewError(null)
    dialog.current?.showModal()
    try {
      const result = await getPagePreview(selected.id)
      if (requestId === previewRequest.current) setPreview(result.page)
    } catch (error) { if (requestId === previewRequest.current) setPreviewError(error) }
  }
  async function save(format: 'png' | 'svg') {
    if (!canDownload || !selected) return
    setExporting(true)
    setQrError(null)
    try {
      const filename = `${selected.slug}-qr.${format}`
      if (format === 'svg') {
        download(new Blob([await makeSvg(address, size, dark, light, badge)], { type: 'image/svg+xml;charset=utf-8' }), filename)
      } else {
        const code = document.createElement('canvas')
        await QRCode.toCanvas(code, address, { width: size, margin: 4, errorCorrectionLevel: 'M', color: { dark, light } })
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size + (badge ? badgeHeight(size) : 0)
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Canvas unavailable')
        context.fillStyle = light
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(code, 0, 0)
        if (badge) {
          context.fillStyle = dark
          context.textAlign = 'center'
          context.textBaseline = 'middle'
          context.font = `600 ${Math.round(size * .035)}px Arial,sans-serif`
          context.fillText('OneLink', size / 2, size + badgeHeight(size) * .58)
        }
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG unavailable')), 'image/png'))
        download(blob, filename)
      }
    } catch { setQrError('Your browser could not export the QR code. Please try again.') }
    finally { setExporting(false) }
  }

  if (restricted) return <div className="creator-notice"><LockSimple size={20} />Sharing tools are available after your account is ready.</div>
  if (listError) return <ErrorNotice error={listError} action="Load pages again" onRetry={() => setRetry(value => value + 1)} />
  if (!pages) return <Splash label="Loading your sharing tools" />
  if (!selected) return <section className="creator-empty"><ShareNetwork size={32} /><h1>Share your world.</h1><p>Create your first page to get a unique link and a QR code.</p><Link to="/app/onboarding" className="creator-button creator-button-primary">Create your page<ArrowRight size={16} /></Link></section>

  const availability = live ? 'Your page is live and ready to share.' : selected.moderationStatus !== 'visible' ?
    (selected.moderationStatus === 'under_review' ? 'Your page is awaiting review. Public sharing will be available once it is visible.' : 'Your page is not publicly visible. Open the page editor to review its status.') :
    published ? (publicError ? 'We could not verify that your page is publicly available. Try checking again.' : 'Checking that your page is publicly available…') :
    'This is your planned address. Publish your page to activate sharing and QR downloads.'
  const socialLinks = [
    { name: 'X', Icon: XLogo, href: `https://twitter.com/intent/tweet?url=${encodeURIComponent(address)}` },
    { name: 'WhatsApp', Icon: WhatsappLogo, href: `https://wa.me/?text=${encodeURIComponent(address)}` },
    { name: 'LinkedIn', Icon: LinkedinLogo, href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(address)}` },
    { name: 'Facebook', Icon: FacebookLogo, href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(address)}` },
  ]
  const exportHeight = size + (badge ? badgeHeight(size) : 0)
  const stateLabel = live ? 'Live' : selected.moderationStatus === 'under_review' ? 'In review' : published ? (publicError ? 'Unavailable' : 'Checking') : 'Private'
  return <div className="creator-share">
    <header className="creator-share-heading"><div><p className="creator-eyebrow">Let’s get you out there</p><h1>Share your world<span>.</span></h1><p>One link. Endless connections. Take your page everywhere.</p></div>{pages.length > 1 && <label className="creator-share-page-picker">Page to share<select aria-label="Page to share" value={selected.id} onChange={event => { setSelectedId(event.target.value); setSearchParams({ page: event.target.value }, { replace: true }) }}>{pages.map(page => <option key={page.id} value={page.id}>{page.title || page.slug}</option>)}</select></label>}</header>
    <div className="creator-share-grid">
      <div className="creator-share-controls">
        <section className="creator-share-card creator-share-url-card" aria-labelledby="share-link-heading">
          <div className="creator-share-card-title"><span className="creator-share-symbol"><LinkSimple size={22} /></span><div><h2 id="share-link-heading">Your unique link</h2><p>A little link that opens up your whole world.</p></div><span className={`creator-share-state ${live ? 'is-live' : ''}`}>{stateLabel}</span></div>
          <div className="creator-share-address"><input id="share-page-address" aria-label="Page address" readOnly value={address} /><button type="button" aria-label="Copy address" title="Copy address" onClick={() => void copyAddress()}><Copy size={20} /></button></div>
          <div className="creator-share-link-actions"><button type="button" className="creator-button creator-button-primary" aria-label="Share page" aria-describedby="share-availability" disabled={!live} onClick={() => void sharePage()}><ShareNetwork size={17} />Share link</button>{live ? <Link className="creator-share-open" to={publicPagePath(selected.slug)} target="_blank" rel="noopener noreferrer" aria-label="Open page">Open page<ArrowUpRight size={17} /></Link> : <button type="button" className="creator-share-open" onClick={() => void openPreview()}><LockSimple size={16} />Private preview</button>}</div>
          <p id="share-availability" className="creator-share-availability">{live ? <Check size={15} /> : <Info size={15} />}<span>{availability}{!published && selected.moderationStatus === 'visible' && <Link to={`/app/pages/${selected.id}`}>Review & publish<ArrowRight size={13} /></Link>}{publicError && <button type="button" onClick={() => setPublicRetry(value => value + 1)}>Check again</button>}</span></p>
          {notice && <p role="status" className="creator-share-feedback">{notice}</p>}
        </section>
        <section className="creator-share-card creator-share-social-card" aria-labelledby="share-social-heading"><h2 id="share-social-heading">Spread the word</h2><p>Your audience is already out there. Say hello.</p><div className="creator-share-socials">{socialLinks.map(({ name, Icon, href }) => live ? <a key={name} href={href} aria-label={`Share on ${name}`} target="_blank" rel="noopener noreferrer"><Icon size={24} weight={name === 'X' ? 'regular' : 'fill'} /><span>{name}</span></a> : <button key={name} type="button" disabled aria-label={`Share on ${name}`}><Icon size={24} weight={name === 'X' ? 'regular' : 'fill'} /><span>{name}</span></button>)}</div></section>
        <section className="creator-share-card creator-share-style-card" aria-labelledby="share-style-heading"><div className="creator-share-card-title"><span className="creator-share-symbol"><Palette size={22} /></span><div><h2 id="share-style-heading">Make it yours</h2><p>Your QR code, your signature.</p></div></div>
          <div className="creator-share-color-groups">{[{ label: 'Pattern color', colors: patternColors, value: dark, change: setDark }, { label: 'Background color', colors: backgroundColors, value: light, change: setLight }].map(group => <fieldset key={group.label}><legend>{group.label}</legend><div className="creator-share-swatches">{group.colors.map(color => <button key={color.value} type="button" aria-label={`${color.name} ${group.label.toLowerCase()}`} aria-pressed={group.value === color.value} style={{ '--share-swatch': color.value } as CSSProperties} onClick={() => group.change(color.value)}>{group.value === color.value && <Check size={16} />}</button>)}<label className="creator-share-custom-color" title={`Custom ${group.label.toLowerCase()}`}><span aria-hidden="true">+</span><input type="color" aria-label={`Custom ${group.label.toLowerCase()}`} value={group.value} onChange={event => group.change(event.target.value)} /></label></div></fieldset>)}</div>
          {!safeColors && <p className="creator-share-warning" role="alert">Choose a darker pattern and a lighter background. QR codes need at least 7:1 contrast for reliable scanning.</p>}
          <div className="creator-share-resolution"><label htmlFor="share-resolution">Resolution<span>{size} × {size} px</span></label><input id="share-resolution" aria-label="QR resolution" type="range" min={256} max={2048} step={256} value={size} onChange={event => setSize(Number(event.target.value))} /><div><span>256 px</span><span>2048 px</span></div></div>
          <label className="creator-share-badge-option"><span><strong>Include OneLink badge</strong><small>A small signature below your QR code.</small></span><input aria-label="Include OneLink badge" type="checkbox" checked={badge} onChange={event => setBadge(event.target.checked)} /><span className="creator-share-switch" aria-hidden="true" /></label>
        </section>
      </div>
      <aside className="creator-share-preview-column">
        <section className="creator-share-card creator-share-qr-card" aria-labelledby="share-qr-heading"><div className="creator-share-qr-heading"><div><h2 id="share-qr-heading">Your QR code</h2><p>Good things are just a scan away.</p></div><QrCode size={24} /></div>
          <div className="creator-share-qr-stage"><div className="creator-share-qr-paper">{qrReady && qr ? <div className="creator-share-qr-image" role="img" aria-label={`QR ${live ? 'code' : 'preview'} for ${address}`} dangerouslySetInnerHTML={{ __html: qr.svg }} /> : <div className="creator-share-qr-placeholder"><QrCode size={80} weight="light" /><span>{safeColors ? 'Preparing your QR code…' : 'Choose scan-safe colors'}</span></div>}</div></div>
          <p className="creator-share-scan-caption">Scan. Connect. Explore.</p><p className="creator-share-qr-caption">{live ? 'Ready for business cards, posters, and wherever life takes you.' : 'Preview only. Your page must be public before you can share this code.'}</p>
          {qrError && <p role="alert" className="creator-share-warning">{qrError}</p>}
          <div className="creator-share-downloads"><button type="button" className="creator-button creator-button-primary" aria-describedby="share-availability" disabled={!canDownload} onClick={() => void save('png')}><DownloadSimple size={18} />Download PNG</button><button type="button" className="creator-button creator-button-subtle" aria-describedby="share-availability" disabled={!canDownload} onClick={() => void save('svg')}><DownloadSimple size={18} />Download SVG</button></div>
          <p className="creator-share-export-note">{size} × {exportHeight} px{badge ? ' · Includes a separate badge strip.' : ' · Crisp, clean, ready to go.'}</p>
        </section>
        <div className="creator-share-tip"><span><Info size={20} /></span><div><strong>A small code. A big impression.</strong><p>Add your QR code to your packaging, business card, or next event. Your page is always one scan away.</p></div></div>
      </aside>
    </div>
    <dialog ref={dialog} className="creator-share-preview-dialog" aria-labelledby="share-private-preview-title" onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close() }} onClose={() => { previewRequest.current++ }}><header><div><h2 id="share-private-preview-title">Saved page preview</h2><p>Only you can see this saved version.</p></div><button type="button" className="creator-icon-button" aria-label="Close preview" onClick={() => dialog.current?.close()}><X size={20} /></button></header>{previewError ? <p role="alert" className="creator-share-warning">{errorMessageFor(previewError)}<button type="button" onClick={() => void openPreview()}>Try again</button></p> : preview ? <PageRenderer page={preview} /> : <Splash label="Loading your saved preview" />}</dialog>
  </div>
}
