import { notFound } from '../lib/errors'
import { mediaUrlFor } from '../lib/media'
import { toPublicPage } from './mappers'
import type { LinkGroupRow, UserSocialLinkRow } from '../types'

export interface PublicPageFields {
  slug: string
  title: string | null
  bio: string | null
  theme: string
  layout: string
  accentColor: string | null
  showBranding: boolean
}

export async function renderPublicPage(
  db: D1Database,
  ownerId: string,
  page: PublicPageFields,
  links: Record<string, unknown>[],
  groups: LinkGroupRow[],
) {
  const owner = await db.prepare(
    `SELECT id, username, display_name, bio, location, pronouns, avatar_key, status, deleted_at
       FROM users WHERE id = ? LIMIT 1`,
  ).bind(ownerId).first<{
    id: string
    username: string
    display_name: string | null
    bio: string | null
    location: string | null
    pronouns: string | null
    avatar_key: string | null
    status: string
    deleted_at: number | null
  }>()
  if (!owner || owner.status !== 'active' || owner.deleted_at !== null) throw notFound('Page')

  const socials = await db.prepare(
    `SELECT platform, url, position
       FROM user_social_links
      WHERE user_id = ? AND is_visible = 1
      ORDER BY position ASC, id ASC`,
  ).bind(ownerId).all<Pick<UserSocialLinkRow, 'platform' | 'url' | 'position'>>()
  const displayName = owner.display_name?.trim() ? owner.display_name : owner.username
  const publicOwner = {
    username: owner.username,
    displayName,
    avatarUrl: owner.avatar_key ? mediaUrlFor(owner.avatar_key) : null,
    bio: owner.bio,
    location: owner.location,
    pronouns: owner.pronouns,
    socials: socials.results.map(({ platform, url, position }) => ({ platform, url, position })),
  }
  const renderedGroups = groups
    .filter((group) => links.some((link) => link.groupId === group.id))
    .map(({ id, name, position }) => ({ id, name, position }))
  const publicLinks = links.map(({ createdAt: _createdAt, updatedAt: _updatedAt, ...link }) => link)
  const pageDto = toPublicPage(page, publicOwner, publicLinks, renderedGroups)
  return { page: pageDto, links: publicLinks, groups: renderedGroups }
}
