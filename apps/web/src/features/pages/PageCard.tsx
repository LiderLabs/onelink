import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, Copy, File, Globe, LockSimple, PencilSimple, Trash } from '@phosphor-icons/react'
import { AuthIcon } from '../../components/AuthPage'
import { formatRelative } from '../../lib/css'
import type { OwnerPage, PublicPageDto } from '../../lib/types'
import { getPagePreview, getPublicPage, publicPagePath } from './api'
import { PageRenderer } from './PageRenderer'
import { PublishedPageLink } from './PublishedPageLink'

export function PageCard({ page, onDelete }: { page: OwnerPage; onDelete: () => void }) {
  const [preview, setPreview] = useState<PublicPageDto | null>(null)
  const [previewError, setPreviewError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [copyMessage, setCopyMessage] = useState('')
  const live = page.status === 'published' && page.moderationStatus === 'visible'
  const title = page.title?.trim() || page.slug
  const editorPath = `/app/pages/${encodeURIComponent(page.id)}`
  const address = new URL(publicPagePath(page.slug), window.location.origin).href
  const canDelete = page.accessRole === undefined || page.accessRole === 'owner'

  useEffect(() => {
    let current = true
    setPreview(null)
    setPreviewError(false)
    const request = live ? getPublicPage(page.slug) : getPagePreview(page.id)
    void request.then(result => { if (current) setPreview(result.page) })
      .catch(() => { if (current) setPreviewError(true) })
    return () => { current = false }
  }, [page.id, page.slug, page.updatedAt, live, retry])

  const copyAddress = async () => {
    try { await navigator.clipboard.writeText(address); setCopyMessage('Link copied.') }
    catch { setCopyMessage('Select and copy the address above.') }
  }

  return (
    <article className="creator-page-card">
      <div className="creator-page-card-browser">
        <span className="creator-page-card-favicon" aria-hidden="true"><AuthIcon name="brand" /></span>
        <span className="creator-page-card-browser-address">{window.location.host}{publicPagePath(page.slug)}</span>
        <span className={`creator-badge ${live ? 'creator-badge-live' : 'creator-badge-private'}`}>
          {live ? <Globe size={12} /> : <LockSimple size={12} />}
          {live ? 'Published' : page.moderationStatus === 'under_review' ? 'In review' : page.moderationStatus === 'removed' ? 'Removed' : page.status === 'archived' ? 'Archived' : 'Draft'}
        </span>
      </div>
      <div className="creator-page-card-preview">
        {preview ? <>
          <div className="creator-page-card-preview-inner" aria-hidden="true" inert><PageRenderer page={preview} /></div>
          <Link to={editorPath} className="creator-page-card-preview-link" aria-label={`Open editor for ${title}`}><span>Open editor <PencilSimple size={14} /></span></Link>
        </> : <div className="creator-page-card-preview-placeholder">
          <File size={32} weight="light" />
          <span>{previewError ? 'Preview unavailable' : 'Loading page preview…'}</span>
          {previewError ? <button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button> : <div className="creator-page-preview-skeleton" aria-hidden="true"><i /><i /><i /></div>}
        </div>}
      </div>
      <div className="creator-page-card-body">
        <div className="creator-page-card-title">
          <h2><Link to={editorPath}>{title}</Link></h2>
          {canDelete ? <button type="button" className="creator-page-delete" aria-label={`Delete ${title}`} title="Delete page" onClick={onDelete}><Trash size={18} /></button> : null}
        </div>
        <p className="creator-page-card-updated">Updated {formatRelative(page.updatedAt)}</p>
        <div className="creator-page-card-address">
          {live ? <>
            <PublishedPageLink slug={page.slug} className="creator-page-public-address"><Globe size={15} /><span>{address}</span><ArrowUpRight size={15} /></PublishedPageLink>
            <button type="button" aria-label={`Copy link for ${title}`} title="Copy link" onClick={() => void copyAddress()}>{copyMessage === 'Link copied.' ? <Check size={17} /> : <Copy size={17} />}</button>
          </> : <span className="creator-page-reserved-address"><LockSimple size={15} /><span>{address}</span></span>}
        </div>
        {!live ? <p className="creator-page-card-note">{page.moderationStatus !== 'visible' ? 'This page is not publicly available.' : 'Your address is reserved. Publish when you’re ready.'}</p> : null}
        {copyMessage ? <p role="status" className="creator-page-card-note">{copyMessage}</p> : null}
        {page.unpublishedChanges ? <p className="creator-page-card-note creator-page-card-unsaved">Unpublished edits</p> : null}
        <div className="creator-page-card-actions">
          <Link to={editorPath} className="creator-button creator-button-primary"><PencilSimple size={16} />{page.accessRole === 'viewer' ? 'Open editor' : 'Edit page'}</Link>
          {live ? <PublishedPageLink slug={page.slug} className="creator-button"><ArrowUpRight size={16} />View live</PublishedPageLink> : <Link to={`${editorPath}?tab=publish`} className="creator-text-link">Review page<ArrowUpRight size={16} /></Link>}
        </div>
      </div>
    </article>
  )
}
