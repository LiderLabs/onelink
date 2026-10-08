import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Splash } from '../../components/StatusScreens'
import { Toolbar } from '../../components/Toolbar'
import { errorMessageFor } from '../../lib/api'
import { formatRelative } from '../../lib/css'
import type { OwnerPage, PageStatus } from '../../lib/types'
import { deletePage, listMyPages, publicPagePath } from './api'

const PAGE_SIZE = 12

// The statuses the list can be narrowed to.
//
// `GET /pages/mine` takes `page` and `limit` and nothing else, so there is no
// server-side `status` query to lean on. The filter therefore runs over what is
// already loaded, and the count line says "of N loaded" whenever more than one
// page of results exists — it never claims to have searched the whole list. A
// server-side filter is a change in `apps/api`, not something to fake here.
const FILTERABLE_STATUSES: readonly PageStatus[] = ['published', 'draft', 'archived']

export function PageListRoute() {
  const [params, setParams] = useSearchParams()
  const requestedPage = Number(params.get('page') ?? '1')
  const pageNumber = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const [pages, setPages] = useState<OwnerPage[] | null>(null)
  const [meta, setMeta] = useState<{ page: number; limit: number; total: number; totalPages: number } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [retry, setRetry] = useState(0)
  const [deleting, setDeleting] = useState<OwnerPage | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [deleteError, setDeleteError] = useState<unknown>(null)

  useEffect(() => {
    let current = true
    setPages(null)
    setError(null)
    void listMyPages(pageNumber, PAGE_SIZE).then((result) => {
      if (!current) return
      setPages(result.items)
      setMeta(result.meta)
      if (result.meta.page !== pageNumber) {
        setParams((previous) => {
          const next = new URLSearchParams(previous)
          if (result.meta.page > 1) next.set('page', String(result.meta.page))
          else next.delete('page')
          return next
        }, { replace: true })
      }
    }).catch((cause: unknown) => {
      if (current) setError(cause)
    })
    return () => { current = false }
  }, [pageNumber, retry, setParams])

  useEffect(() => {
    document.title = 'My pages · OneLink'
  }, [])

  const changePage = (nextPage: number) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (nextPage > 1) next.set('page', String(nextPage))
      else next.delete('page')
      return next
    })
  }

  // `?status=` is validated against the allowlist, so a hand-typed value in the
  // address bar reads as "no filter" rather than as an empty list.
  const statusFilter = FILTERABLE_STATUSES.find((status) => status === params.get('status')) ?? null
  const visiblePages = pages?.filter((page) => statusFilter === null || page.status === statusFilter) ?? null
  // Only offer a chip for a status that is present — plus the active one, so a
  // filter that just emptied itself (its last page was deleted) stays visible and
  // clearable instead of silently sticking.
  const statusChips = FILTERABLE_STATUSES.filter(
    (status) => status === statusFilter || (pages?.some((page) => page.status === status) ?? false),
  )

  const setStatusFilter = (next: PageStatus | null) => {
    setParams((previous) => {
      const updated = new URLSearchParams(previous)
      if (next === null) updated.delete('status')
      else updated.set('status', next)
      // `page` is deliberately left alone: the filter narrows the loaded page, so
      // walking the list keeps it and each page shows its own slice.
      return updated
    })
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeletePending(true)
    setDeleteError(null)
    try {
      await deletePage(deleting.id)
      setDeleting(null)
      setPages((current) => current?.filter((page) => page.id !== deleting.id) ?? [])
      setMeta((current) => current ? { ...current, total: Math.max(0, current.total - 1) } : current)
      if (pages?.length === 1 && pageNumber > 1) changePage(pageNumber - 1)
    } catch (cause) {
      setDeleteError(cause)
    } finally {
      setDeletePending(false)
    }
  }

  if (pages === null && error === null) return <Splash label="Loading your pages" />

  return (
    <section className="mx-auto max-w-7xl">
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-ink pb-6">
        <div>
          <p className="eyebrow">Your corner of the internet</p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight sm:text-4xl">My pages</h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-soft">
            Make a small home for the places people can find you.
          </p>
        </div>
        <Link to="/app/pages/new" className="inline-flex min-h-11 items-center border border-ink bg-ink px-5 font-mono text-xs uppercase tracking-[0.16em] text-white transition-colors hover:bg-white hover:text-ink">
          Create a page <span className="ml-3 text-base" aria-hidden="true">↗</span>
        </Link>
      </div>

      {error ? (
        <ErrorNotice error={error} action="Load your pages again" onRetry={() => setRetry((value) => value + 1)} />
      ) : pages?.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="A blank page, in the best way."
            action={<Link to="/app/pages/new" className="font-mono text-xs uppercase tracking-[0.14em] underline underline-offset-4">Create your first page</Link>}
          >
            Your pages will live here. Start with a title and a memorable address; you can add links in the editor.
          </EmptyState>
        </div>
      ) : (
        <>
          {meta ? (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
              {statusChips.length > 1 ? (
                <Toolbar label="Filter pages by status">
                  <Button
                    size="sm"
                    variant={statusFilter === null ? 'solid' : 'outline'}
                    aria-pressed={statusFilter === null}
                    onClick={() => setStatusFilter(null)}
                  >
                    All
                  </Button>
                  {statusChips.map((status) => (
                    <Button
                      key={status}
                      size="sm"
                      variant={statusFilter === status ? 'solid' : 'outline'}
                      aria-pressed={statusFilter === status}
                      onClick={() => setStatusFilter(status)}
                    >
                      {status}
                    </Button>
                  ))}
                </Toolbar>
              ) : null}
              <div className="ml-auto text-right">
                <p className="eyebrow">{meta.total} {meta.total === 1 ? 'page' : 'pages'}</p>
                <p className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-faint">
                  {statusFilter === null
                    ? meta.total === 0
                      ? 'No results'
                      : `${(meta.page - 1) * meta.limit + 1}–${Math.min(meta.page * meta.limit, meta.total)} of ${meta.total}`
                    : meta.totalPages === 1
                      ? `${visiblePages?.length ?? 0} of ${meta.total}`
                      : `${visiblePages?.length ?? 0} of ${pages?.length ?? 0} loaded`}
                </p>
              </div>
            </div>
          ) : null}
          {meta && statusFilter !== null && visiblePages?.length === 0 ? (
            <p className="mt-4 border border-rule bg-white/60 px-5 py-6 text-sm leading-relaxed text-ink-soft">
              {meta.totalPages === 1
                ? `No ${statusFilter} pages here.`
                : `No ${statusFilter} pages among the ${pages?.length ?? 0} loaded — move through the pages below to check the rest.`}
            </p>
          ) : null}
          <div className="mt-4 grid gap-3">
            {visiblePages?.map((page, index) => (
              <article key={page.id} className="grid gap-4 border border-rule bg-white/80 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-5" style={{ animationDelay: `${Math.min(index, 7) * 45}ms` }}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <h2 className="font-display text-2xl font-medium leading-tight">
                      <Link to={`/app/pages/${encodeURIComponent(page.id)}`} className="decoration-1 underline-offset-4 hover:underline">
                        {page.title?.trim() || page.slug}
                      </Link>
                    </h2>
                    <span className={`stamp ${page.status === 'published' ? '' : 'text-ink-faint'}`}>{page.status}</span>
                    {page.moderationStatus !== 'visible' ? <span className="stamp text-danger">{page.moderationStatus.replace('_', ' ')}</span> : null}
                    {page.unpublishedChanges ? <span className="eyebrow">Unpublished edits</span> : null}
                  </div>
                  <p className="mt-2 truncate font-mono text-xs text-ink-soft">/{page.slug}</p>
                  <p className="mt-2 text-xs text-ink-faint">Updated {formatRelative(page.updatedAt)}</p>
                </div>
                <div className="flex items-center gap-4 sm:justify-end">
                  {page.status === 'published' ? (
                    <a href={publicPagePath(page.slug)} target="_blank" rel="noreferrer" className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] underline underline-offset-4">View live</a>
                  ) : null}
                  <button type="button" onClick={() => { setDeleteError(null); setDeleting(page) }} className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-danger underline underline-offset-4">
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
          {meta && meta.totalPages > 1 ? (
            <nav aria-label="Page list pagination" className="mt-6 flex items-center justify-between">
              <Button variant="outline" disabled={meta.page <= 1} onClick={() => changePage(meta.page - 1)}>Previous</Button>
              <p className="font-mono text-xs tabular-nums">Page {meta.page} of {meta.totalPages}</p>
              <Button variant="outline" disabled={meta.page >= meta.totalPages} onClick={() => changePage(meta.page + 1)}>Next</Button>
            </nav>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete “${deleting?.title || deleting?.slug || 'this page'}”?`}
        confirmLabel="Delete page"
        tone="danger"
        pending={deletePending}
        onConfirm={() => void confirmDelete()}
        onCancel={() => { if (!deletePending) setDeleting(null) }}
      >
        <p>The page and its links will be removed. Its address <strong>/{deleting?.slug}</strong> stays reserved and cannot be reused.</p>
        {deleteError ? <p role="alert" className="mt-3 text-danger">{errorMessageFor(deleteError)}</p> : null}
      </ConfirmDialog>
    </section>
  )
}
