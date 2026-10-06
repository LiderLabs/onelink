import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { errorMessageFor, fieldErrorsFrom } from '../../lib/api'
import { useResource } from '../../lib/use-resource'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { CheckboxField, Field, SelectField } from '../../components/Field'
import { EmptyState } from '../../components/EmptyState'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Notice } from '../../components/Notice'
import type { SocialLink, SocialPlatform } from '../../lib/types'
import { socialsApi } from './api'
import { SocialRow } from './SocialRow'
import {
  MAX_SOCIALS_PER_PROFILE,
  MAX_SOCIAL_URL_LENGTH,
  SOCIAL_PLATFORM_OPTIONS,
  platformLabel,
} from './social-platforms'

// ============================================================================
// Social links — `/profile/socials` (R1.2).
//
// The read is GATED, not merely guarded afterwards. `GET /profile/socials` sits
// behind `requireActiveAccount` and `requirePasswordSettled`, so a suspended
// account or a session with a forced password change would be answered `403`.
// The spec is explicit that such a session must not make the request at all
// (§5): asking, and then rendering the refusal as an error, would present a
// deliberate policy as a fault. `readable` turns the request off and
// `blockedReason` says why the section is empty.
//
// Impersonation is the opposite case: an administrator acting as this account MAY
// read the list (support has to see what it is looking at) and must not write it,
// so reading is `writable === false` rather than `readable === false`.
//
// Every write refetches rather than patching local state: positions are the
// server's, and a reorder in particular has no honest local equivalent (spec §10).
// ============================================================================

export interface SocialsEditorProps {
  /** The endpoint's own preconditions hold: active account, settled password. */
  readable: boolean
  /** Not an impersonated session. */
  writable: boolean
  /** Why the section is empty when `readable` is false. Never rendered otherwise. */
  blockedReason: ReactNode
}

export function SocialsEditor({ readable, writable, blockedReason }: SocialsEditorProps) {
  const socials = useResource(socialsApi.list, { enabled: readable })

  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ platform?: string; url?: string }>({})
  const [confirming, setConfirming] = useState<SocialLink | null>(null)

  const [platform, setPlatform] = useState<string>('website')
  const [url, setUrl] = useState('')
  const [visible, setVisible] = useState(true)

  const list = socials.data?.socials ?? []
  const atCap = list.length >= MAX_SOCIALS_PER_PROFILE

  const reset = () => {
    setUrl('')
    setVisible(true)
    setFieldErrors({})
  }

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setNotice(null)

    const address = url.trim()
    if (address.length === 0) {
      setFieldErrors({ url: 'A URL is required.' })
      return
    }

    setPending(true)
    try {
      await socialsApi.create({
        // The options come from `SOCIAL_PLATFORMS` verbatim; a `<select>` hands
        // the value over as a plain string.
        platform: platform as SocialPlatform,
        url: address,
        isVisible: visible,
      })
      reset()
      socials.reload()
      setNotice('Added to the end of the list. Use Move up to reorder it.')
    } catch (caught) {
      const blamed = fieldErrorsFrom(caught)
      setFieldErrors({ platform: blamed.platform, url: blamed.url })
      // The cap and a refused address are plain `400`s with no `issues`, so they
      // have no field to sit on and are said out loud instead.
      if (blamed.platform === undefined && blamed.url === undefined) setError(caught)
    } finally {
      setPending(false)
    }
  }

  /**
   * Moves a row one slot, then submits the WHOLE order.
   *
   * The body must name every row exactly once — including hidden ones, because
   * visibility is not order — or the server refuses it with a `400`. So the new
   * order is computed from the list as displayed and sent in full.
   */
  const move = async (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= list.length) return

    const ids = list.map((social) => social.id)
    const [moved] = ids.splice(index, 1)
    if (moved === undefined) return
    ids.splice(target, 0, moved)

    setError(null)
    setNotice(null)
    setPending(true)
    try {
      await socialsApi.reorder(ids)
      socials.reload()
      setNotice('Order saved.')
    } catch (caught) {
      setError(caught)
    } finally {
      setPending(false)
    }
  }

  const remove = async () => {
    if (!confirming) return
    setError(null)
    setNotice(null)
    setPending(true)
    try {
      await socialsApi.remove(confirming.id)
      setConfirming(null)
      socials.reload()
      setNotice('Link deleted.')
    } catch (caught) {
      // A `404` here means the row is already gone — someone else's delete, or a
      // stale tab. The list is refetched so the screen stops showing it.
      setError(caught)
      setConfirming(null)
      socials.reload()
    } finally {
      setPending(false)
    }
  }

  return (
    <section aria-labelledby="socials" className="mt-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="socials" className="eyebrow">
          Social links
        </h2>
        {readable ? (
          <p className="eyebrow">
            {list.length} of {MAX_SOCIALS_PER_PROFILE} used
          </p>
        ) : null}
      </div>

      <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-soft">
        Where else you are. This order is the order they appear in; a new link is always appended.
      </p>

      {!readable ? (
        <Notice tone="info" label="Not requested" className="mt-5">
          {blockedReason}
        </Notice>
      ) : (
        <>
          {error ? (
            <Notice tone="error" label="That did not work" className="mt-5">
              {errorMessageFor(error)}
            </Notice>
          ) : null}

          {notice ? (
            <Notice tone="success" label="Done" delay={1} className="mt-5">
              {notice}
            </Notice>
          ) : null}

          {socials.loading ? (
            <p className="eyebrow mt-6" role="status">
              Loading your links
            </p>
          ) : socials.error ? (
            <ErrorNotice
              error={socials.error}
              action="Load the links again"
              onRetry={socials.reload}
              delay={1}
            />
          ) : list.length === 0 ? (
            <EmptyState title="No social links yet" delay={1}>
              Add the places you actually post — a website, a portfolio, a profile. Up to{' '}
              {MAX_SOCIALS_PER_PROFILE} of them, in whatever order you like.
            </EmptyState>
          ) : (
            <ul className="mt-6 border-t border-rule">
              {list.map((social, index) => (
                <SocialRow
                  key={social.id}
                  social={social}
                  index={index}
                  count={list.length}
                  writable={writable}
                  busy={pending}
                  onMove={(position, delta) => void move(position, delta)}
                  onDelete={setConfirming}
                  onSaved={setNotice}
                />
              ))}
            </ul>
          )}

          {atCap ? (
            <p className="mt-6 border-t border-rule pt-5 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-soft">
              {MAX_SOCIALS_PER_PROFILE} of {MAX_SOCIALS_PER_PROFILE} used — delete one to add another
            </p>
          ) : null}

          {writable && !atCap ? (
            <form onSubmit={(event) => void add(event)} noValidate className="mt-8 space-y-5">
              <p className="eyebrow">Add a social link</p>

              <div className="grid gap-5 sm:grid-cols-2">
                <SelectField
                  label="Platform"
                  options={SOCIAL_PLATFORM_OPTIONS}
                  value={platform}
                  disabled={pending}
                  error={fieldErrors.platform ?? null}
                  onChange={(event) => setPlatform(event.target.value)}
                />

                <Field
                  label="URL"
                  type="url"
                  inputMode="url"
                  required
                  value={url}
                  maxLength={MAX_SOCIAL_URL_LENGTH}
                  disabled={pending}
                  hint="http or https only. Credentials in the address are stripped."
                  error={fieldErrors.url ?? null}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </div>

              <CheckboxField
                label="Visible"
                checked={visible}
                disabled={pending}
                hint="A hidden link stays in this list but is left out of your published page."
                onChange={(event) => setVisible(event.target.checked)}
              />

              <Button type="submit" pending={pending} pendingLabel="Adding">
                Add link
              </Button>
            </form>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={confirming !== null}
        title={`Delete the ${confirming ? platformLabel(confirming.platform) : ''} link?`}
        confirmLabel="Delete link"
        tone="danger"
        pending={pending}
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(null)}
      >
        {confirming ? (
          <>
            <span className="break-all font-mono text-xs text-ink">{confirming.url}</span> is removed
            from your profile and the list closes up around it. A social link has no history to
            keep, so this one is deleted outright rather than archived — it cannot be recovered.
          </>
        ) : null}
      </ConfirmDialog>
    </section>
  )
}