import { useState } from 'react'
import type { FormEvent } from 'react'
import { errorMessageFor, fieldErrorsFrom } from '../../lib/api'
import { Button } from '../../components/Button'
import { CheckboxField, Field, SelectField } from '../../components/Field'
import { Notice } from '../../components/Notice'
import type { SocialLink, SocialPlatform, UpdateSocialInput } from '../../lib/types'
import { socialsApi } from './api'
import { MAX_SOCIAL_URL_LENGTH, SOCIAL_PLATFORM_OPTIONS, platformLabel } from './social-platforms'

// ============================================================================
// One social row.
//
// Editing happens IN the row rather than in a dialog, and that is a decision
// about focus: an inline form has no focus to trap, nothing to restore, and no
// "which row was I editing?" state to keep in sync with the list. Reordering uses
// explicit Move up / Move down buttons — usable by keyboard and touch, no
// drag-and-drop this pass (spec §4).
//
// A delta edit, like the API's: only the fields that moved are sent, and a save
// with nothing changed just closes the form instead of writing an audit row that
// records somebody setting a value to what it already was.
// ============================================================================

export interface SocialRowProps {
  social: SocialLink
  index: number
  count: number
  /** Writes are refused for an impersonated session, so the row is read-only. */
  writable: boolean
  /** True while any write on this list is in flight, so rows cannot race. */
  busy: boolean
  onMove: (index: number, delta: -1 | 1) => void
  onDelete: (social: SocialLink) => void
  onSaved: (message: string) => void
}

export function SocialRow({
  social,
  index,
  count,
  writable,
  busy,
  onMove,
  onDelete,
  onSaved,
}: SocialRowProps) {
  const [editing, setEditing] = useState(false)
  const [platform, setPlatform] = useState<string>(social.platform)
  const [url, setUrl] = useState(social.url)
  const [isVisible, setIsVisible] = useState(social.isVisible)
  const [fieldErrors, setFieldErrors] = useState<{ platform?: string; url?: string }>({})
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const label = platformLabel(social.platform)

  const startEditing = () => {
    // Re-seeded from the row every time it opens, so a cancelled edit cannot
    // leave a stale draft behind for the next one.
    setPlatform(social.platform)
    setUrl(social.url)
    setIsVisible(social.isVisible)
    setFieldErrors({})
    setError(null)
    setEditing(true)
  }

  const onSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    const patch: UpdateSocialInput = {}
    // The options come from `SOCIAL_PLATFORMS` verbatim, so this value can only be
    // one the API accepts; a `<select>` hands it over as a plain string.
    if (platform !== social.platform) patch.platform = platform as SocialPlatform
    if (url.trim() !== social.url) patch.url = url.trim()
    if (isVisible !== social.isVisible) patch.isVisible = isVisible

    if (Object.keys(patch).length === 0) {
      setEditing(false)
      return
    }

    setPending(true)
    try {
      await socialsApi.update(social.id, patch)
      setEditing(false)
      onSaved(`Updated the ${label} link.`)
    } catch (caught) {
      const blamed = fieldErrorsFrom(caught)
      setFieldErrors({ platform: blamed.platform, url: blamed.url })
      // A refused URL is a plain `400` with no `issues`, so it has no field to sit
      // on and is said above the controls instead.
      if (blamed.platform === undefined && blamed.url === undefined) {
        setError(errorMessageFor(caught))
      }
    } finally {
      setPending(false)
    }
  }

  if (editing) {
    return (
      <li className="profile-social-row is-editing border-b border-rule py-5">
        <form onSubmit={(event) => void onSave(event)} noValidate className="space-y-5">
          {error ? (
            <Notice tone="error" label="Could not save">
              {error}
            </Notice>
          ) : null}

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
              value={url}
              maxLength={MAX_SOCIAL_URL_LENGTH}
              disabled={pending}
              hint="http or https only."
              error={fieldErrors.url ?? null}
              onChange={(event) => setUrl(event.target.value)}
            />
          </div>

          <CheckboxField
            label="Show on my page"
            checked={isVisible}
            disabled={pending}
            hint="A hidden link stays in this list but is left out of the published page."
            onChange={(event) => setIsVisible(event.target.checked)}
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" pending={pending} pendingLabel="Saving" className="px-4 py-2">
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              className="px-4 py-2"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </li>
    )
  }

  return (
    <li className="profile-social-row border-b border-rule py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="eyebrow">
            {label}
            <span className="ml-2 text-ink-faint">#{index + 1}</span>
            {social.isVisible ? null : (
              <span className="profile-social-visibility">Hidden</span>
            )}
          </p>
          {/* Shown as the stored address, not as a prettified handle: this is the
              value in the database, and someone checking their profile needs to
              see exactly what will be published. */}
          <a
            href={social.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 block truncate text-sm text-ink underline decoration-rule underline-offset-4 hover:decoration-ink"
          >
            {social.url}
          </a>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="px-3 py-1.5 text-[0.625rem]"
            disabled={busy || !writable || index === 0}
            aria-label={`Move the ${label} link up`}
            onClick={() => onMove(index, -1)}
          >
            Move up
          </Button>
          <Button
            variant="outline"
            className="px-3 py-1.5 text-[0.625rem]"
            disabled={busy || !writable || index === count - 1}
            aria-label={`Move the ${label} link down`}
            onClick={() => onMove(index, 1)}
          >
            Move down
          </Button>
          <Button
            variant="outline"
            className="px-3 py-1.5 text-[0.625rem]"
            disabled={busy || !writable}
            aria-label={`Edit the ${label} link`}
            onClick={startEditing}
          >
            Edit
          </Button>
          <Button
            variant="danger"
            className="px-3 py-1.5 text-[0.625rem]"
            disabled={busy || !writable}
            aria-label={`Delete the ${label} link`}
            onClick={() => onDelete(social)}
          >
            Delete
          </Button>
        </div>
      </div>
    </li>
  )
}
