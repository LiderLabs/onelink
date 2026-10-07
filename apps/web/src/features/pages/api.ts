import { request, requestList } from '../../lib/api'
import type {
  CreatePageInput,
  LinkGroup,
  OwnerPage,
  OwnerPageDetail,
  PageDraftContent,
  PageDraftState,
  PageLink,
  PageLinkInput,
  PageListMeta,
  PageRevision,
  PublicPageDto,
  UpdatePageInput,
} from '../../lib/types'

export function listMyPages(page: number, limit = 12) {
  return requestList<OwnerPage>(`/pages/mine?page=${page}&limit=${limit}`)
}

export function createPage(input: CreatePageInput) {
  return request<OwnerPage>('/pages', { method: 'POST', body: JSON.stringify(input) })
}

export function getPage(id: string) {
  return request<OwnerPageDetail>(`/pages/${encodeURIComponent(id)}`)
}

export function getPagePreview(id: string) {
  return request<{ page: PublicPageDto }>(`/pages/${encodeURIComponent(id)}/preview`)
}

export function checkSlugAvailability(slug: string) {
  return request<{ slug: string; available: boolean; reason: 'reserved' | 'taken' | 'reservation' | null }>(
    `/pages/slug-available?slug=${encodeURIComponent(slug)}`,
  )
}

export function slugReasonMessage(reason: 'reserved' | 'taken' | 'reservation' | null): string {
  if (reason === 'reserved') return 'This address is reserved by OneLink.'
  if (reason === 'reservation') return 'This address is held by a page-address reservation.'
  if (reason === 'taken') return 'This address is already in use.'
  return 'This address is available.'
}

export function updatePage(id: string, input: UpdatePageInput) {
  return request<OwnerPage>(`/pages/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function deletePage(id: string) {
  return request<void>(`/pages/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function createPageLink(pageId: string, input: PageLinkInput) {
  return request<PageLink>(`/pages/${encodeURIComponent(pageId)}/links`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updatePageLink(pageId: string, linkId: string, input: PageLinkInput) {
  return request<PageLink>(`/pages/${encodeURIComponent(pageId)}/links/${encodeURIComponent(linkId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function deletePageLink(pageId: string, linkId: string) {
  return request<void>(`/pages/${encodeURIComponent(pageId)}/links/${encodeURIComponent(linkId)}`, {
    method: 'DELETE',
  })
}

export function reorderPageLinks(pageId: string, linkIds: string[]) {
  return request<{ links: PageLink[] }>(`/pages/${encodeURIComponent(pageId)}/links/order`, {
    method: 'PUT',
    body: JSON.stringify({ linkIds }),
  })
}

export function listPageLinks(pageId: string, trashed = false) {
  return request<{ links: PageLink[] }>(
    `/pages/${encodeURIComponent(pageId)}/links${trashed ? '?trashed=1' : ''}`,
  )
}

export function listLinkGroups(pageId: string) {
  return request<{ groups: LinkGroup[] }>(`/pages/${encodeURIComponent(pageId)}/groups`)
}

export function createLinkGroup(pageId: string, name: string) {
  return request<LinkGroup>(`/pages/${encodeURIComponent(pageId)}/groups`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function updateLinkGroup(pageId: string, groupId: string, name: string) {
  return request<LinkGroup>(`/pages/${encodeURIComponent(pageId)}/groups/${encodeURIComponent(groupId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export function deleteLinkGroup(pageId: string, groupId: string) {
  return request<void>(`/pages/${encodeURIComponent(pageId)}/groups/${encodeURIComponent(groupId)}`, {
    method: 'DELETE',
  })
}

export function reorderLinkGroups(pageId: string, groupIds: string[]) {
  return request<{ groups: LinkGroup[] }>(`/pages/${encodeURIComponent(pageId)}/groups/order`, {
    method: 'PUT',
    body: JSON.stringify({ groupIds }),
  })
}

export function bulkUpdatePageLinks(
  pageId: string,
  ids: string[],
  action: 'hide' | 'show' | 'move',
  groupId?: string | null,
) {
  return request<{ links: PageLink[] }>(`/pages/${encodeURIComponent(pageId)}/links/bulk`, {
    method: 'POST',
    body: JSON.stringify({ ids, action, ...(action === 'move' ? { groupId } : {}) }),
  })
}

export function restorePageLink(pageId: string, linkId: string) {
  return request<PageLink>(`/pages/${encodeURIComponent(pageId)}/links/${encodeURIComponent(linkId)}/restore`, {
    method: 'POST',
  })
}

export function fetchPageLinkMetadata(pageId: string, url: string) {
  return request<{ url: string; title: string | null; description: string | null }>(
    `/pages/${encodeURIComponent(pageId)}/links/metadata`,
    { method: 'POST', body: JSON.stringify({ url }) },
  )
}

export function getPageDraft(pageId: string) {
  return request<{ draft: PageDraftState }>(`/pages/${encodeURIComponent(pageId)}/draft`)
}

export function savePageDraft(pageId: string, content: PageDraftContent, updatedAt: number | null) {
  return request<{ draft: PageDraftState }>(`/pages/${encodeURIComponent(pageId)}/draft`, {
    method: 'PUT',
    body: JSON.stringify({ content, updatedAt }),
  })
}

export function discardPageDraft(pageId: string) {
  return request<{ draft: PageDraftState }>(`/pages/${encodeURIComponent(pageId)}/draft/discard`, { method: 'POST' })
}

export function listPageRevisions(pageId: string) {
  return request<{ revisions: PageRevision[] }>(`/pages/${encodeURIComponent(pageId)}/revisions`)
}

export function getPageRevision(pageId: string, revision: number) {
  return request<{ revision: PageRevision; content: PageDraftContent }>(
    `/pages/${encodeURIComponent(pageId)}/revisions/${revision}`,
  )
}

export function restorePageRevision(pageId: string, revision: number) {
  return request<{ draft: PageDraftState }>(
    `/pages/${encodeURIComponent(pageId)}/revisions/${revision}/restore`,
    { method: 'POST' },
  )
}

export function publishPage(id: string) {
  return request<OwnerPage>(`/pages/${encodeURIComponent(id)}/publish`, { method: 'POST' })
}

export function unpublishPage(id: string) {
  return request<OwnerPage>(`/pages/${encodeURIComponent(id)}/unpublish`, { method: 'POST' })
}

export function getPublicPage(slug: string) {
  return request<{ page: PublicPageDto }>(`/public/pages/${encodeURIComponent(slug)}`)
}

const ROOT_ROUTE_COLLISIONS = new Set([
  'app',
  'forgot-password',
  'login',
  'p',
  'profile',
  'register',
  'reset-password',
])

export function publicPagePath(slug: string): string {
  const encoded = encodeURIComponent(slug)
  return ROOT_ROUTE_COLLISIONS.has(slug.toLowerCase()) ? `/p/${encoded}` : `/${encoded}`
}

export type { OwnerPage, OwnerPageDetail, PageLink, PageListMeta, PublicPageDto }
