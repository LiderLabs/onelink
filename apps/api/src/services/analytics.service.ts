import { notFound } from '../lib/errors'
import { normalizeSlug } from '../lib/http'
import { DAY } from '../lib/constants'
import { now } from '../lib/clock'
import type { PublicPageEvent } from '../validation/analytics.schema'

async function findVisiblePublishedPage(db: D1Database, rawSlug: string): Promise<{ id: string } | null> {
  const slug = normalizeSlug(rawSlug)
  if (slug.length === 0) return null
  return db.prepare(`SELECT pages.id FROM pages
    JOIN users ON users.id=pages.user_id
    WHERE pages.slug=? AND pages.deleted_at IS NULL AND pages.status='published'
      AND pages.moderation_status='visible' AND users.status='active' AND users.deleted_at IS NULL
    LIMIT 1`).bind(slug).first<{ id: string }>()
}

export async function recordPublicPageEvent(
  db: D1Database,
  rawSlug: string,
  event: PublicPageEvent,
): Promise<void> {
  const page = await findVisiblePublishedPage(db, rawSlug)
  if (!page) throw notFound('Page')

  const timestamp = now()
  const eventDate = new Date(timestamp).toISOString().slice(0, 10)
  const update = event.type === 'view'
    ? db.prepare(`UPDATE pages SET view_count=view_count+1
        WHERE id=? AND deleted_at IS NULL AND status='published' AND moderation_status='visible'
          AND EXISTS (SELECT 1 FROM users WHERE users.id=pages.user_id AND users.status='active' AND users.deleted_at IS NULL)`)
      .bind(page.id)
    : db.prepare(`UPDATE page_links SET clicks=clicks+1
        WHERE id=? AND page_id=? AND deleted_at IS NULL AND is_visible=1
          AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>=?)
          AND EXISTS (SELECT 1 FROM pages JOIN users ON users.id=pages.user_id
            WHERE pages.id=page_links.page_id AND pages.deleted_at IS NULL
              AND pages.status='published' AND pages.moderation_status='visible'
              AND users.status='active' AND users.deleted_at IS NULL)`)
      .bind(event.linkId, page.id, timestamp, timestamp)

  const aggregate = event.type === 'view'
    ? db.prepare(`INSERT INTO page_analytics_daily(page_id,event_date,views,clicks)
        SELECT ?,?,1,0 WHERE changes()=1
        ON CONFLICT(page_id,event_date) DO UPDATE SET views=views+1`)
      .bind(page.id, eventDate)
    : db.prepare(`INSERT INTO page_analytics_daily(page_id,event_date,views,clicks)
        SELECT ?,?,0,1 WHERE changes()=1
        ON CONFLICT(page_id,event_date) DO UPDATE SET clicks=clicks+1`)
      .bind(page.id, eventDate)

  const results = await db.batch([update, aggregate])
  if (results[0]?.meta.changes !== 1) throw notFound(event.type === 'click' ? 'Link' : 'Page')
}

export interface PageAnalytics {
  days: number
  totalViews: number
  totalClicks: number
  daily: Array<{ date: string; views: number; clicks: number }>
  links: Array<{ id: string; title: string; clicks: number }>
}

export async function getPageAnalytics(db: D1Database, pageId: string, days: number): Promise<PageAnalytics> {
  const today = new Date(now())
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - days + 1)
  const startDate = start.toISOString().slice(0, 10)
  const [page, dailyRows, linkRows, clickTotal] = await Promise.all([
    db.prepare('SELECT view_count FROM pages WHERE id=?').bind(pageId).first<{ view_count: number }>(),
    db.prepare(`SELECT event_date,views,clicks FROM page_analytics_daily
      WHERE page_id=? AND event_date>=? ORDER BY event_date ASC`).bind(pageId, startDate)
      .all<{ event_date: string; views: number; clicks: number }>(),
    db.prepare(`SELECT id,title,clicks FROM page_links WHERE page_id=? AND deleted_at IS NULL
      ORDER BY clicks DESC,position ASC,id ASC LIMIT 20`).bind(pageId)
      .all<{ id: string; title: string; clicks: number }>(),
    db.prepare('SELECT coalesce(sum(clicks),0) AS total FROM page_links WHERE page_id=?')
      .bind(pageId).first<{ total: number }>(),
  ])
  const byDate = new Map(dailyRows.results.map((row) => [row.event_date, row]))
  const daily = Array.from({ length: days }, (_, index) => {
    const date = new Date(start)
    date.setUTCDate(date.getUTCDate() + index)
    const key = date.toISOString().slice(0, 10)
    const row = byDate.get(key)
    return { date: key, views: row?.views ?? 0, clicks: row?.clicks ?? 0 }
  })
  return {
    days,
    totalViews: page?.view_count ?? 0,
    totalClicks: clickTotal?.total ?? 0,
    daily,
    links: linkRows.results,
  }
}

export async function prunePageAnalytics(db: D1Database, retentionDays: number, referenceTime = now()): Promise<number> {
  const boundedDays = Math.min(Math.max(Math.trunc(retentionDays), 90), 3650)
  const cutoff = new Date(referenceTime - boundedDays * DAY).toISOString().slice(0, 10)
  const result = await db.prepare('DELETE FROM page_analytics_daily WHERE event_date<?').bind(cutoff).run()
  return result.meta.changes ?? 0
}