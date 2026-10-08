import type { OwnerPage } from '../../lib/types'
import { listMyPages } from '../pages/api'

// Publication history is the existing API's durable completion signal. Account
// restriction status is unrelated to whether a creator has finished setup.
export function hasCompletedSetup(pages: OwnerPage[]) {
  return pages.some(page => page.publishedAt !== null || page.revision !== null)
}

export async function getSetupPages() {
  const result = await listMyPages(1, 100)
  const pages = [...result.items]
  for (let page = 2; page <= result.meta.totalPages; page++) {
    pages.push(...(await listMyPages(page, 100)).items)
  }
  return pages.filter(page => !page.accessRole || page.accessRole === 'owner')
}

export function readSetupCursor(userId: string): { pageId: string; step: number } | null {
  try {
    const cursor = JSON.parse(localStorage.getItem(`onelink.setup.${userId}`) ?? 'null')
    return cursor && typeof cursor.pageId === 'string' && Number.isInteger(cursor.step) && cursor.step >= 2 && cursor.step <= 5 ? cursor : null
  } catch { return null }
}

export function writeSetupCursor(userId: string, pageId: string, step: number) {
  // This stores only a navigation hint. All content and publication live in D1.
  try { localStorage.setItem(`onelink.setup.${userId}`, JSON.stringify({ pageId, step })) } catch { /* Storage may be unavailable. */ }
}
