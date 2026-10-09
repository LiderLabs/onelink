import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Field, SelectField, TextareaField } from '../../components/Field'
import { ApiError, errorMessageFor, fieldErrorsFrom } from '../../lib/api'
import { useUnsavedChanges } from '../../lib/dirty-form'
import { checkSlugAvailability, createPage, slugReasonMessage } from './api'
import type { CreatePageInput } from '../../lib/types'

interface FormValues {
  slug: string
  title: string
  bio: string
  theme: 'light' | 'dark'
  layout: 'list' | 'grid'
  accentColor: string
  showBranding: boolean
}

const INITIAL: FormValues = {
  slug: '',
  title: '',
  bio: '',
  theme: 'light',
  layout: 'list',
  accentColor: '',
  showBranding: true,
}

export function PageCreateRoute() {
  const navigate = useNavigate()
  const [values, setValues] = useState<FormValues>(INITIAL)
  const [createdPageId, setCreatedPageId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const [slugCheck, setSlugCheck] = useState<{ status: 'idle' | 'checking' | 'available' | 'unavailable' | 'error'; message: string | null }>({ status: 'idle', message: null })
  const [checkedSlug, setCheckedSlug] = useState('')
  const dirty = JSON.stringify(values) !== JSON.stringify(INITIAL)
  const navigation = useUnsavedChanges(dirty)

  useEffect(() => {
    const slug = values.slug.trim()
    if (!slug) {
      setSlugCheck({ status: 'idle', message: null })
      setCheckedSlug('')
      return
    }
    let current = true
    setSlugCheck({ status: 'checking', message: null })
    setCheckedSlug('')
    const timer = window.setTimeout(() => {
      void checkSlugAvailability(slug).then((result) => {
        if (!current) return
        setCheckedSlug(slug)
        setSlugCheck({
          status: result.available ? 'available' : 'unavailable',
          message: slugReasonMessage(result.reason),
        })
      }).catch((cause: unknown) => {
        if (!current) return
        setSlugCheck({ status: 'error', message: errorMessageFor(cause) })
      })
    }, 350)
    return () => { current = false; window.clearTimeout(timer) }
  }, [values.slug])

  useEffect(() => {
    if (createdPageId && !dirty) navigate(`/app/pages/${encodeURIComponent(createdPageId)}`, { replace: true })
  }, [createdPageId, dirty, navigate])

  const update = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
    if (fieldErrorsFrom(error)[key]) setError(null)
  }

  const fieldErrors = fieldErrorsFrom(error)
  useEffect(() => {
    if (!pending && error) {
      const invalid = formRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-invalid="true"]')
      if (invalid) invalid.focus()
      else errorRef.current?.focus()
    }
  }, [pending, error])

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    const input: CreatePageInput = {
      ...(values.slug.trim() ? { slug: values.slug.trim() } : {}),
      ...(values.title.trim() ? { title: values.title.trim() } : {}),
      ...(values.bio.trim() ? { bio: values.bio.trim() } : {}),
      theme: values.theme,
      layout: values.layout,
      accentColor: values.accentColor.trim() || null,
      showBranding: values.showBranding,
    }
    try {
      const created = await createPage(input)
      setValues(INITIAL)
      setCreatedPageId(created.id)
    } catch (cause) {
      setError(cause)
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="mx-auto max-w-4xl">
      <Link to="/app/pages" className="eyebrow underline underline-offset-4">← All pages</Link>
      <div className="mt-7 border-b border-ink pb-7">
        <p className="eyebrow">A new beginning</p>
        <h1 className="mt-3 font-display text-3xl font-medium tracking-tight sm:text-4xl">Create a page</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-soft">
          Choose the name people will see and the address they can remember. You can build the links after creation.
        </p>
      </div>

      <form ref={formRef} onSubmit={(event) => void submit(event)} className="mt-7 grid gap-6 border border-rule bg-white/80 p-5 sm:p-7">
        <Field
          label="Page title"
          name="title"
          maxLength={120}
          value={values.title}
          onChange={(event) => update('title', event.currentTarget.value)}
          error={fieldErrors.title}
          hint="Optional. If left empty, the address is used as the page name."
          autoComplete="off"
        />
        <Field
          label="Page address"
          name="slug"
          maxLength={48}
          value={values.slug}
          onChange={(event) => update('slug', event.currentTarget.value)}
          error={fieldErrors.slug}
          hint={slugCheck.status === 'available' && !fieldErrors.slug
            ? slugCheck.message ?? undefined
            : 'Optional; letters, numbers, hyphens and underscores. We check availability as you type.'}
          autoComplete="off"
          spellCheck={false}
        />
        {slugCheck.status === 'checking' ? <p role="status" className="-mt-6 font-mono text-[0.625rem] text-ink-faint">Checking address…</p> : null}
        {slugCheck.status === 'available' && !fieldErrors.slug ? <p role="status" className="-mt-6 font-mono text-[0.625rem] text-ink-soft">{slugCheck.message}</p> : null}
        {slugCheck.status === 'error' ? <p role="alert" className="-mt-6 font-mono text-[0.625rem] text-danger">{slugCheck.message}</p> : null}
        <TextareaField
          label="Short introduction"
          name="bio"
          maxLength={500}
          rows={3}
          value={values.bio}
          onChange={(event) => update('bio', event.currentTarget.value)}
          error={fieldErrors.bio}
          hint={`${values.bio.length}/500`}
        />

        <div className="grid gap-6 sm:grid-cols-2">
          <SelectField
            label="Theme"
            value={values.theme}
            onChange={(event) => update('theme', event.currentTarget.value === 'dark' ? 'dark' : 'light')}
            options={[{ value: 'light', label: 'Black with cyan glow' }, { value: 'dark', label: 'Solid black' }]}
          />
          <SelectField
            label="Link layout"
            value={values.layout}
            onChange={(event) => update('layout', event.currentTarget.value === 'grid' ? 'grid' : 'list')}
            options={[{ value: 'list', label: 'Editorial list' }, { value: 'grid', label: 'Compact grid' }]}
          />
        </div>

        <Field
          label="Accent colour"
          name="accentColor"
          type="text"
          maxLength={7}
          value={values.accentColor}
          onChange={(event) => update('accentColor', event.currentTarget.value)}
          error={fieldErrors.accentColor}
          hint="Optional #rrggbb, used as a restrained highlight."
          placeholder="#d3a84c"
        />

        <label className="flex items-start gap-3 border-y border-rule py-4 text-sm leading-relaxed">
          <input
            type="checkbox"
            checked={values.showBranding}
            onChange={(event) => update('showBranding', event.currentTarget.checked)}
            className="mt-1 accent-black"
          />
          <span><strong className="font-medium">Show OneLink credit</strong><span className="block text-ink-soft">A small platform credit appears at the bottom of your public page.</span></span>
        </label>

        {error && Object.keys(fieldErrors).length === 0 ? (
          <div ref={errorRef} tabIndex={-1} role="alert" className="border-l-2 border-danger pl-4 text-sm leading-relaxed text-danger">
            <p>{errorMessageFor(error)}</p>
            {error instanceof ApiError && error.code === 'CONFLICT'
              ? <p className="mt-1 text-ink-soft">That address is reserved or already in use. Your entries are still here; choose another address and try again.</p>
              : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" pending={pending} pendingLabel="Creating page" disabled={Boolean(values.slug.trim()) && (slugCheck.status !== 'available' || checkedSlug !== values.slug.trim() || Boolean(fieldErrors.slug))}>Create page</Button>
          <Link to="/app/pages" className="font-mono text-xs uppercase tracking-[0.12em] text-ink-soft underline underline-offset-4">Cancel</Link>
          <span className="ml-auto font-mono text-[0.625rem] uppercase tracking-[0.12em] text-ink-faint">Saved when created</span>
        </div>
      </form>

      <ConfirmDialog
        open={navigation.blocked}
        title="Leave this new page?"
        confirmLabel="Leave page"
        onConfirm={navigation.proceed}
        onCancel={navigation.stay}
      >
        Your page details have not been saved. Leaving now will discard them.
      </ConfirmDialog>
    </section>
  )
}
