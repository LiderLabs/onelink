import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../../components/EmptyState'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Splash } from '../../components/StatusScreens'
import { ApiError } from '../../lib/api'
import { getPublicPage } from '../pages/api'
import { PageRenderer } from '../pages/PageRenderer'
import type { PublicPageDto } from '../../lib/types'

export function PublicPageRoute() {
  const { slug = '' } = useParams<{ slug: string }>()
  const [page, setPage] = useState<PublicPageDto | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let current = true
    setPage(null)
    setError(null)
    void getPublicPage(slug).then((result) => {
      if (!current) return
      setPage(result.page)
      document.title = `${result.page.title?.trim() || result.page.owner.displayName} · OneLink`
    }).catch((cause: unknown) => {
      if (current) setError(cause)
    })
    return () => { current = false }
  }, [slug, retry])

  if (page) return <PageRenderer page={page} />
  if (error === null) return <Splash label="Finding this page" />
  if (error instanceof ApiError && error.status === 404) {
    return (
      <EmptyState
        title="This page isn’t available"
        action={<Link to="/login" className="font-mono text-xs uppercase tracking-[0.14em] underline underline-offset-4">Sign in</Link>}
      >
        It may be unpublished, removed, or the address may be wrong.
      </EmptyState>
    )
  }
  return <ErrorNotice error={error} action="Try loading this page again" onRetry={() => setRetry((value) => value + 1)} />
}
