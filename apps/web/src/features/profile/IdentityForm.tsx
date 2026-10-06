import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { ApiError, errorMessageFor, fieldErrorsFrom } from '../../lib/api'
import { useDirtyForm, useUnsavedChanges } from '../../lib/dirty-form'
import { useSession } from '../../lib/session'
import type { SessionUser, UpdateProfileInput } from '../../lib/types'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Field, TextareaField } from '../../components/Field'
import { Notice } from '../../components/Notice'
import type { PreviewIdentity } from './ProfilePreview'

// ============================================================================
// Identity — the first section of `/app/profile` (R1.1, extended by R1.2).
//
// The contract, read from `PATCH /auth/me`, `updateOwnProfile` and
// `lib/constants.ts`:
//
//   displayName  1..50   never cleared — the service re-checks after stripping
//                        control characters, so an emptied name is a 400
//   username     3..32   [a-zA-Z0-9._-]; 409 when taken, 400 when reserved
//   bio          0..160  ┐
//   location     0..100  ├ null clears; the service folds "" into null as well
//   pronouns     0..40   ┘
//
// Three rules shape the form:
//
//   1. CHANGED FIELDS ONLY. The service reads `undefined` as "not in the body",
//      so sending the whole form would rewrite columns nobody touched and fill
//      the audit row with noise.
//   2. `null` clears, `""` does not. An emptied optional box is sent as null.
//   3. LONG VALUES READ. Caps apply on write only (D12): a row written before a
//      cap existed still displays whole. `maxLength` stops anything NEW from
//      going over, and a legacy-long value left alone is never validated because
//      it is never sent.
// ============================================================================

const DISPLAY_NAME_MAX = 50
const BIO_MAX = 160
const LOCATION_MAX = 100
const PRONOUNS_MAX = 40
const USERNAME_MIN = 3
const USERNAME_MAX = 32
/** Mirrors `usernameSchema` in `apps/api/src/validation/common.ts`. */
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/

/**
 * Every field is a string, because that is what an input holds.
 *
 * A type alias rather than an `interface` on purpose: `useDirtyForm<T>` needs
 * `Record<string, string>`, and only an anonymous object type gets TypeScript's
 * implicit index signature — an interface would have to declare one.
 */
type IdentityDraft = {
  displayName: string
  username: string
  bio: string
  location: string
  pronouns: string
}

function baselineOf(user: SessionUser): IdentityDraft {
  return {
    displayName: user.displayName,
    username: user.username,
    // `null` on the wire, `""` in the box: an empty input is how someone sees
    // "nothing here", and the diff below turns it back into null on the way out.
    bio: user.bio ?? '',
    location: user.location ?? '',
    pronouns: user.pronouns ?? '',
  }
}

/** `""` means clear, and clearing a nullable column is `null`. */
function cleared(raw: string): string | null {
  const trimmed = raw.trim()
  return trimmed.length === 0 ? null : trimmed
}

/** Only the keys that actually moved. */
function diffIdentity(values: IdentityDraft, original: IdentityDraft): UpdateProfileInput {
  const patch: UpdateProfileInput = {}

  if (values.displayName !== original.displayName) patch.displayName = values.displayName.trim()
  if (values.username !== original.username) patch.username = values.username.trim()
  if (values.bio !== original.bio) patch.bio = cleared(values.bio)
  if (values.location !== original.location) patch.location = cleared(values.location)
  if (values.pronouns !== original.pronouns) patch.pronouns = cleared(values.pronouns)

  return patch
}

/**
 * The same checks the server makes, so a too-long or malformed value is answered
 * in place instead of after a round trip. It is a courtesy, not the authority:
 * the server still refuses what it refuses, and its refusal is what the form
 * renders.
 */
function validatePatch(patch: UpdateProfileInput): Record<string, string> {
  const errors: Record<string, string> = {}

  if (patch.displayName !== undefined) {
    const value = patch.displayName.trim()
    if (value.length === 0) errors.displayName = 'A display name is required.'
    else if (value.length > DISPLAY_NAME_MAX)
      errors.displayName = `Display names must be at most ${DISPLAY_NAME_MAX} characters.`
  }

  if (patch.username !== undefined) {
    const value = patch.username.trim()
    if (value.length < USERNAME_MIN)
      errors.username = `Usernames must be at least ${USERNAME_MIN} characters.`
    else if (value.length > USERNAME_MAX)
      errors.username = `Usernames must be at most ${USERNAME_MAX} characters.`
    else if (!USERNAME_PATTERN.test(value))
      errors.username = 'Usernames may only contain letters, numbers, ., _ and -.'
  }

  const lengths: Array<['bio' | 'location' | 'pronouns', number, string]> = [
    ['bio', BIO_MAX, 'Bios'],
    ['location', LOCATION_MAX, 'Locations'],
    ['pronouns', PRONOUNS_MAX, 'Pronouns'],
  ]
  for (const [key, max, label] of lengths) {
    const value = patch[key]
    if (typeof value === 'string' && value.trim().length > max) {
      errors[key] = `${label} must be at most ${max} characters.`
    }
  }

  return errors
}

export interface IdentityFormProps {
  user: SessionUser
  /** A session that may read but not write: impersonated, forced rotation, suspended. */
  disabled: boolean
  navigationLocked: boolean
  onPreviewChange?: (identity: PreviewIdentity) => void
}

export function IdentityForm({ user, disabled, navigationLocked, onPreviewChange }: IdentityFormProps) {
  const session = useSession()

  const baseline = useMemo(() => baselineOf(user), [user])
  const form = useDirtyForm<IdentityDraft>(baseline)
  const guard = useUnsavedChanges((form.dirty && !disabled) || navigationLocked)

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(false)

  /**
   * A session that ends under a dirty form — sign-out, or the hard 8-hour
   * ceiling — must not strand the reader behind a "discard your changes?" dialog
   * about a form they can no longer save. Releasing the blocker lets the route
   * guard take them to the login screen with a `next` path back to here.
   */
  useEffect(() => {
    if (session.user === null) guard.proceed()
  }, [session.user, guard])

  const values = form.draft?.values ?? baseline
  useEffect(() => { onPreviewChange?.(values) }, [values, onPreviewChange])

  const change = (key: keyof IdentityDraft, value: string) => {
    form.setValue(key, value)
    setSaved(false)
    // The complaint about a field stops being true the moment it is edited, so it
    // is withdrawn here rather than left standing until the next submit.
    setFieldErrors((previous) => {
      if (!(key in previous)) return previous
      const next = { ...previous }
      delete next[key]
      return next
    })
  }

  const field =
    (key: keyof IdentityDraft) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      change(key, event.target.value)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form.draft) return

    setBanner(null)
    setSaved(false)

    const patch = diffIdentity(form.draft.values, form.draft.original)
    const errors = validatePatch(patch)
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0 || Object.keys(patch).length === 0) return

    setPending(true)
    try {
      const updated = await session.updateProfile(patch)
      // The baseline resets to the SERVER's values, not to what was typed:
      // trimming, control-character stripping and ""→null all happened on the way
      // in, so a second submit must diff against what is actually stored.
      form.reset(baselineOf(updated))
      setSaved(true)
    } catch (caught) {
      const blamed = fieldErrorsFrom(caught)
      // A taken or reserved username is named in the MESSAGE rather than in
      // `issues` (409 CONFLICT / 400 BAD_REQUEST), so it is attached to the field
      // the fix belongs in instead of announced above the whole form.
      if (
        caught instanceof ApiError &&
        'username' in patch &&
        (caught.code === 'CONFLICT' || caught.code === 'BAD_REQUEST')
      ) {
        blamed.username = caught.message
      }
      setFieldErrors(blamed)
      // Anything not blamed on a field (429, a dead connection, a 500) has to be
      // said out loud: the API's sentence, plus its retry interval when it sent one.
      setBanner(Object.keys(blamed).length === 0 ? errorMessageFor(caught) : null)
    } finally {
      setPending(false)
    }
  }

  return (
    <section aria-labelledby="identity" className="profile-section profile-identity">
      <div className="profile-section-heading">
        <div>
          <p className="profile-section-number" aria-hidden="true">02</p>
          <h2 id="identity">Profile details</h2>
        </div>
        {/* A live summary rather than a silent disabled button: the reader can
            always tell whether there is anything left to send. */}
        <p className={`profile-save-status${form.dirty ? ' is-dirty' : ''}`} aria-live="polite">
          <span aria-hidden="true">{form.dirty ? '●' : '✓'}</span>{' '}
          {saved && !form.dirty ? 'Changes saved' : form.dirty ? 'Unsaved changes' : 'Up to date'}
        </p>
      </div>

      <p className="profile-section-description">
        Introduce yourself. These details help people get to know you.
      </p>

      {banner ? (
        <Notice tone="error" label="Could not save" className="mt-5">
          {banner}
        </Notice>
      ) : null}

      {saved ? (
        <Notice tone="success" label="Identity saved" delay={1} className="mt-5">
          Your profile details are up to date.
        </Notice>
      ) : null}

      <form onSubmit={(event) => void onSubmit(event)} noValidate className="mt-6 space-y-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <Field
            label="Display name"
            name="displayName"
            autoComplete="name"
            required
            delay={1}
            maxLength={DISPLAY_NAME_MAX}
            disabled={disabled}
            hint="The name people will see."
            error={fieldErrors.displayName ?? null}
            value={values.displayName}
            onChange={field('displayName')}
          />

          <Field
            label="Username"
            name="username"
            autoComplete="username"
            required
            delay={2}
            maxLength={USERNAME_MAX}
            disabled={disabled}
            hint={`${USERNAME_MIN}–${USERNAME_MAX} characters: letters, numbers, . _ -`}
            error={fieldErrors.username ?? null}
            value={values.username}
            onChange={field('username')}
          />

          <div className="sm:col-span-2">
            <TextareaField
              label="Bio"
              name="bio"
              rows={3}
              delay={3}
              maxLength={BIO_MAX}
              disabled={disabled}
              hint={`${values.bio.length}/${BIO_MAX} characters. A few words about you.`}
              error={fieldErrors.bio ?? null}
              value={values.bio}
              onChange={field('bio')}
            />
          </div>

          <Field
            label="Location"
            name="location"
            delay={4}
            maxLength={LOCATION_MAX}
            disabled={disabled}
            hint="Where you are, in your own words. Optional."
            error={fieldErrors.location ?? null}
            value={values.location}
            onChange={field('location')}
          />

          <Field
            label="Pronouns"
            name="pronouns"
            delay={5}
            maxLength={PRONOUNS_MAX}
            disabled={disabled}
            hint="Optional."
            error={fieldErrors.pronouns ?? null}
            value={values.pronouns}
            onChange={field('pronouns')}
          />
        </div>

        <div className="flex flex-wrap items-center gap-5">
          <Button
            type="submit"
            pending={pending}
            pendingLabel="Saving"
            disabled={disabled || !form.dirty}
          >
            Save changes
          </Button>

          {form.dirty && !disabled ? (
            <button
              type="button"
              onClick={() => {
                form.reset(baselineOf(user))
                setFieldErrors({})
                setBanner(null)
                setSaved(false)
              }}
              className="border-b border-transparent font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
            >
              Undo changes
            </button>
          ) : null}
        </div>
      </form>

      <ConfirmDialog
        open={guard.blocked}
        pending={navigationLocked}
        title="Leave with unsaved identity changes?"
        confirmLabel="Discard and leave"
        cancelLabel="Keep editing"
        onConfirm={guard.proceed}
        onCancel={guard.stay}
      >
        Your edits have not been saved. Leaving now discards them; the account still holds the
        values shown before you started typing.
      </ConfirmDialog>
    </section>
  )
}
