import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, SquaresFour } from '@phosphor-icons/react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Splash } from '../../components/StatusScreens'
import { errorMessageFor } from '../../lib/api'
import type { OwnerPage, PageStatus } from '../../lib/types'
import { deletePage, listMyPages } from './api'
import { PageCard } from './PageCard'
import './pages-list.css'

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
    <section className="creator-pages">
      <header className="creator-heading">
        <div>
          <p className="creator-eyebrow">Your creator workspace</p>
          <h1>My pages<span className="creator-accent" aria-hidden="true">.</span></h1>
          <p>
            Your pages, ready to edit and share. One home for every part of your world.
          </p>
        </div>
        <Link to="/app/pages/new" className="creator-button creator-button-primary">
          <Plus size={18} />Create a page
        </Link>
      </header>

      {error ? (
        <ErrorNotice error={error} action="Load your pages again" onRetry={() => setRetry((value) => value + 1)} />
      ) : pages?.length === 0 ? (
        <div className="creator-pages-empty">
          <SquaresFour size={36} weight="light" />
          <h2>Your next page starts here</h2>
          <p>Create a page, add your favorite links, and make it yours. You can publish when everything is ready.</p>
          <Link to="/app/pages/new" className="creator-button creator-button-primary"><Plus size={17} />Create your first page</Link>
        </div>
      ) : (
        <>
          {meta ? (
            <div className="creator-pages-toolbar">
                <div className="creator-pages-filters" role="group" aria-label="Filter pages by status">
                  <button
                    type="button"
                    aria-pressed={statusFilter === null}
                    onClick={() => setStatusFilter(null)}
                  >
                    All pages
                  </button>
                  {statusChips.map((status) => (
                    <button
                      key={status}
                      type="button"
                      aria-pressed={statusFilter === status}
                      onClick={() => setStatusFilter(status)}
                    >
                      {status[0]?.toUpperCase()}{status.slice(1)}
                    </button>
                  ))}
                </div>
              <div className="creator-pages-count">
                <strong>{meta.total} {meta.total === 1 ? 'page' : 'pages'}</strong><span aria-hidden="true"> · </span>
                <span>
                  {statusFilter === null
                    ? meta.total === 0
                      ? 'No results'
                      : `${(meta.page - 1) * meta.limit + 1}–${Math.min(meta.page * meta.limit, meta.total)} of ${meta.total}`
                    : meta.totalPages === 1
                      ? `${visiblePages?.length ?? 0} of ${meta.total}`
                      : `${visiblePages?.length ?? 0} of ${pages?.length ?? 0} loaded`}
                </span>
              </div>
            </div>
          ) : null}
          {meta && statusFilter !== null && visiblePages?.length === 0 ? (
            <p className="creator-notice mb-5">
              {meta.totalPages === 1
                ? `No ${statusFilter} pages here.`
                : `No ${statusFilter} pages among the ${pages?.length ?? 0} loaded — move through the pages below to check the rest.`}
            </p>
          ) : null}
          <div className="creator-pages-grid">
            {visiblePages?.map((page) => (
              <PageCard key={page.id} page={page} onDelete={() => { setDeleteError(null); setDeleting(page) }} />
            ))}
          </div>
          {meta && meta.totalPages > 1 ? (
            <nav aria-label="Page list pagination" className="creator-pages-pagination">
              <button type="button" className="creator-button" disabled={meta.page <= 1} onClick={() => changePage(meta.page - 1)}>Previous</button>
              <p>Page {meta.page} of {meta.totalPages}</p>
              <button type="button" className="creator-button" disabled={meta.page >= meta.totalPages} onClick={() => changePage(meta.page + 1)}>Next</button>
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
