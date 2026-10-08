import { useLayoutEffect, useRef, useState } from 'react'
import { DeviceMobile, Desktop, Info, Link as LinkIcon } from '@phosphor-icons/react'
import type { PageDraftContent, PublicPageOwner } from '../../lib/types'
import { PageRenderer } from '../pages/PageRenderer'
import type { PageRenderModel } from '../pages/PageRenderer'
import type { PreviewPhoto } from '../profile/ProfilePreview'

export function draftModel(slug: string, content: PageDraftContent, owner: PublicPageOwner): PageRenderModel {
  const now = Date.now()
  return {
    slug, ...content.page, owner,
    groups: content.groups.map((group, position) => ({ ...group, id: group.id ?? `preview-group-${position}`, position })),
    links: content.links.map((link, position) => ({ ...link, id: link.id ?? `preview-link-${position}`, position, domain: null, createdAt: 0, updatedAt: 0,
      status: link.startsAt !== null && link.startsAt > now ? 'scheduled' : link.endsAt !== null && link.endsAt <= now ? 'expired' : 'active' })),
  }
}

function CropPreview({ photo }: { photo: PreviewPhoto }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const { crop } = photo
    canvas.current?.getContext('2d')?.drawImage(photo.photo.source, crop.x, crop.y, crop.size, crop.size, 0, 0, 512, 512)
  }, [photo])
  return <canvas ref={canvas} width={512} height={512} role="img" aria-label="Profile photo preview" className="creator-preview-photo" />
}

export function CreatorPreview({ page, photo = null, published = false, compact = false, pendingReview = false, draftNotice }: {
  page: PageRenderModel; photo?: PreviewPhoto | null; published?: boolean; compact?: boolean; pendingReview?: boolean; draftNotice?: string
}) {
  const [viewport, setViewport] = useState<'mobile' | 'desktop'>('mobile')
  return <aside className="creator-preview" aria-label="Live page preview">
    <div className="creator-preview-heading"><div><h2>{published ? 'Page preview' : 'Live page preview'}</h2><p>See what your audience will see</p></div>
      <span className={`creator-badge ${published ? 'creator-badge-live' : 'creator-badge-private'}`}>{published ? 'Page live' : pendingReview ? 'Awaiting review' : 'Draft · private'}</span></div>
    {!compact && <div className="creator-preview-modes" role="group" aria-label="Preview viewport">
      <button type="button" aria-pressed={viewport === 'mobile'} onClick={() => setViewport('mobile')}><DeviceMobile size={16} />Mobile</button>
      <button type="button" aria-pressed={viewport === 'desktop'} onClick={() => setViewport('desktop')}><Desktop size={16} />Desktop</button>
    </div>}
    <div className={viewport === 'mobile' ? 'creator-phone' : 'creator-preview-desktop'}>
      <div className={viewport === 'mobile' ? 'creator-phone-screen' : undefined}>
        <PageRenderer page={page} avatarOverride={photo ? <CropPreview photo={photo} /> : undefined} emptyState={
          <div className="creator-empty"><LinkIcon size={24} /><h3>Your links will appear here</h3><p>Add your first destination or turn a hidden link back on.</p></div>
        } />
      </div>
    </div>
    {!published && !compact && <p className="creator-notice"><Info size={18} className="shrink-0" />{draftNotice ?? (pendingReview ? 'Your page stays private while it is under review.' : 'Your page stays private until you publish. Profile and social details are saved to your account.')}</p>}
  </aside>
}
