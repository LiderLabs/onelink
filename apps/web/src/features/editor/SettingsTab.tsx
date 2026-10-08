import { useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { Field } from '../../components/Field'
import { Icon } from '../../components/Icon'
import { PageHeader } from '../../components/PageHeader'
import { Panel } from '../../components/Panel'
import { errorMessageFor, fieldErrorsFrom } from '../../lib/api'
import { checkSlugAvailability, publicPagePath, slugReasonMessage, updatePage } from '../pages/api'
import { QrCodeTools } from '../pages/QrCodeTools'
import { useEditor } from './context'

// ============================================================================
// The Settings tab.
//
// Three real things and three honest placeholders. Real: the page address (a
// `PATCH /pages/:id` slug change) and sharing via copy-link and a client-side QR
// code. Placeholders: a custom domain, a contact form / newsletter, and team
// access — the mockup shows all three, but the owner loop was not built against
// a domain, form or invitation endpoint, so they are disabled and labelled
// rather than faked.
// ============================================================================

type SlugCheck = { status: 'idle' | 'checking' | 'available' | 'unavailable' | 'error'; message: string | null }

export function SettingsTab() {
  const { page, reload, canManage } = useEditor()
  const [slug, setSlug] = useState(page.slug)
  const [slugCheck, setSlugCheck] = useState<SlugCheck>({ status: 'idle', message: null })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [saved, setSaved] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => { setSlug(page.slug) }, [page.slug])

  useEffect(() => {
    const next = slug.trim()
    if (!next || next === page.slug) {
      setSlugCheck({ status: 'idle', message: null })
      return
    }
    let current = true
    setSlugCheck({ status: 'checking', message: null })
    const timer = window.setTimeout(() => {
      void checkSlugAvailability(next).then((result) => {
        if (current) setSlugCheck({ status: result.available ? 'available' : 'unavailable', message: slugReasonMessage(result.reason) })
      }).catch(() => {
        if (current) setSlugCheck({ status: 'error', message: 'Could not check that address.' })
      })
    }, 350)
    return () => { current = false; window.clearTimeout(timer) }
  }, [slug, page.slug])

  const saveSlug = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await updatePage(page.id, { slug: slug.trim() })
      setSaved(true)
      reload()
    } catch (cause: unknown) {
      setError(cause)
    } finally {
      setSaving(false)
    }
  }

  const publicUrl = new URL(publicPagePath(page.slug), window.location.origin).href
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* A locked clipboard is not worth an error banner. */
    }
  }

  const fieldErrors = fieldErrorsFrom(error)
  const slugDirty = slug.trim() !== page.slug
  const canSaveSlug = canManage && slugDirty && slugCheck.status === 'available' && !saving

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Creator settings"
        title="Settings"
        description="Your page address, how it is shared, and the access and collection features still to come."
        actions={<span className="border border-rule px-3 py-1.5 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-ink-soft">Plan · Creator</span>}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel eyebrow="Page address" title="Your public handle">
          <p className="text-sm leading-relaxed text-ink-soft">
            Your unique address across web and mobile. Every link on your page resolves through it.
          </p>
          <div className="mt-5 space-y-5">
            <Field
              label="Page address"
              value={slug}
              disabled={!canManage || saving}
              hint="Letters, numbers, and dashes. Changing this updates your live address."
              error={fieldErrors.slug ?? null}
              onChange={(event) => { setSlug(event.currentTarget.value); setSaved(false); setError(null) }}
            />
            {slugDirty && slugCheck.message ? (
              <p
                role="status"
                className={slugCheck.status === 'unavailable' || slugCheck.status === 'error' ? 'font-mono text-[0.6875rem] text-danger' : 'font-mono text-[0.6875rem] text-ink-soft'}
              >
                {slugCheck.message}
              </p>
            ) : null}
            {error && !fieldErrors.slug ? <p role="alert" className="text-sm text-danger">{errorMessageFor(error)}</p> : null}
            <div className="flex flex-wrap items-center gap-4">
              <Button type="button" size="sm" pending={saving} disabled={!canSaveSlug} onClick={() => void saveSlug()}>
                Change address
              </Button>
              {saved ? <span role="status" className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-soft">Address updated</span> : null}
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Custom domain" title="Bring your own address">
          <div className="flex items-center gap-2 text-ink-faint">
            <Icon name="globe" size={18} />
            <span className="font-mono text-[0.6875rem] uppercase tracking-[0.12em]">Not connected</span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            Point an apex or subdomain at OneLink to cloak your address under your own web property.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3 opacity-60">
            <input aria-disabled="true" disabled placeholder="links.yourbrand.com" className="min-w-0 flex-1 border-b border-rule bg-transparent py-2 text-base" />
            <Button variant="outline" size="sm" disabled>Connect domain</Button>
          </div>
          <p className="mt-3 font-mono text-[0.6875rem] text-ink-faint">Not saved yet. Custom domains are planned for a later release.</p>
        </Panel>
      </div>

      <Panel
        eyebrow="Sharing"
        title="Scannable asset"
        description="Copy your address, use your device's share sheet, or export a QR code for print."
        action={<span className="stamp">Available now</span>}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => void copyLink()}>
            <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'Copied' : 'Copy link'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowQr((value) => !value)} aria-expanded={showQr}>
            <Icon name="qr" size={16} /> {showQr ? 'Hide QR code' : 'Create QR code'}
          </Button>
          <span className="font-mono text-[0.6875rem] text-ink-soft">{publicUrl.replace(/^https?:\/\//, '')}</span>
        </div>
        {showQr ? <QrCodeTools url={publicUrl} name={page.slug} /> : null}
      </Panel>

      <Panel
        eyebrow="Not connected"
        title="Contact, newsletter & team"
        description="These appear in the mockup but the owner loop has no endpoint for them yet, so they are disabled rather than pretending to work."
      >
        <div className="grid gap-6 md:grid-cols-2">
          <div className="border border-rule p-5 opacity-60">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">Contact form</p>
              <span className="stamp">Disabled</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Collect messages from your profile without exposing private inbox credentials. No form endpoint exists yet.
            </p>
          </div>
          <div className="border border-rule p-5 opacity-60">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">Newsletter</p>
              <span className="stamp">Disabled</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Substack or Mailchimp sign-ups are planned for a later release. No subscriber list is stored yet.
            </p>
          </div>
          <div className="border border-rule p-5 opacity-60 md:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">Team access</p>
              <span className="stamp">Disabled</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Invite collaborators and assign page roles. The team API exists, but this management UI is not built yet, so nothing here is inviteable.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  )
}
