import { conflict, notFound } from '../lib/errors'
import { now } from '../lib/clock'
import { ulid } from '../lib/ids'
import { auditInsertStmt } from './audit.service'
import type { ActorInfo, Auditor, PageRow } from '../types'

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

interface MemberRow {
  user_id: string
  email: string
  username: string
  display_name: string | null
  role: 'viewer' | 'editor'
  created_at: number
}

interface OwnerRow {
  id: string
  email: string
  username: string
  display_name: string | null
  created_at: number
}

interface InvitationRow {
  id: string
  page_id: string
  email: string
  role: 'viewer' | 'editor'
  invited_by: string | null
  inviter_username: string | null
  inviter_display_name: string | null
  page_slug?: string
  page_title?: string | null
  page_owner_id?: string
  created_at: number
  expires_at: number
}

function memberDto(row: MemberRow | OwnerRow, role: 'owner' | 'editor' | 'viewer') {
  return {
    userId: 'user_id' in row ? row.user_id : row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name ?? row.username,
    role,
    joinedAt: row.created_at,
  }
}

function invitationDto(row: InvitationRow) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    invitedBy: row.invited_by
      ? {
          userId: row.invited_by,
          username: row.inviter_username,
          displayName: row.inviter_display_name ?? row.inviter_username,
        }
      : null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }
}

export async function listPageMembers(
  db: D1Database,
  page: PageRow,
): Promise<Array<ReturnType<typeof memberDto>>> {
  const [owner, members] = await Promise.all([
    db.prepare(
      `SELECT id, email, username, display_name, created_at
         FROM users WHERE id = ?`,
    ).bind(page.user_id).first<OwnerRow>(),
    db.prepare(
      `SELECT u.id AS user_id, u.email, u.username, u.display_name,
              pm.role, pm.created_at
         FROM page_members pm
         JOIN users u ON u.id = pm.user_id
        WHERE pm.page_id = ?
        ORDER BY pm.created_at, pm.user_id`,
    ).bind(page.id).all<MemberRow>(),
  ])

  if (!owner) throw notFound('Page')
  return [
    memberDto(owner, 'owner'),
    ...members.results.map((row) => memberDto(row, row.role)),
  ]
}

export async function listPageInvitations(
  db: D1Database,
  pageId: string,
): Promise<Array<ReturnType<typeof invitationDto>>> {
  const { results } = await db.prepare(
    `SELECT i.id, i.page_id, i.email, i.role, i.invited_by, i.created_at, i.expires_at,
            u.username AS inviter_username, u.display_name AS inviter_display_name
       FROM page_invitations i
       LEFT JOIN users u ON u.id = i.invited_by
      WHERE i.page_id = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL
        AND i.expires_at > ?
      ORDER BY i.created_at DESC, i.id DESC`,
  ).bind(pageId, now()).all<InvitationRow>()
  return results.map(invitationDto)
}

export async function createPageInvitation(
  db: D1Database,
  page: PageRow,
  actor: ActorInfo,
  input: { email: string; role: 'viewer' | 'editor' },
  auditor: Auditor,
): Promise<ReturnType<typeof invitationDto>> {
  if (actor.id !== page.user_id) throw notFound('Page')
  const email = input.email.trim().toLowerCase()
  const timestamp = now()

  const invitee = await db.prepare(
    'SELECT id FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1',
  ).bind(email).first<{ id: string }>()
  if (invitee?.id === page.user_id) throw conflict('The page owner already has access.')
  if (invitee) {
    const member = await db.prepare(
      'SELECT 1 AS found FROM page_members WHERE page_id = ? AND user_id = ? LIMIT 1',
    ).bind(page.id, invitee.id).first()
    if (member) throw conflict('That user already has access to this page.')
  }

  const existing = await db.prepare(
    `SELECT id FROM page_invitations
      WHERE page_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL
        AND expires_at > ? LIMIT 1`,
  ).bind(page.id, email, timestamp).first()
  if (existing) throw conflict('An active invitation already exists for that email address.')

  const id = ulid()
  const expiresAt = timestamp + INVITATION_TTL_MS
  const entry = auditor.claim({
    action: 'page.invitation.create',
    targetType: 'page',
    targetId: page.id,
    targetLabel: page.slug,
    after: { email, role: input.role, invitationId: id },
  })

  const results = await db.batch([
    db.prepare(
      `UPDATE page_invitations SET revoked_at = ?
        WHERE page_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL
          AND expires_at <= ?`,
    ).bind(timestamp, page.id, email, timestamp),
    db.prepare(
      `INSERT INTO page_invitations
         (id, page_id, email, role, invited_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(page_id, email)
         WHERE accepted_at IS NULL AND revoked_at IS NULL
       DO NOTHING`,
    ).bind(id, page.id, email, input.role, actor.id, timestamp, expiresAt),
    auditInsertStmt(db, entry, true),
  ])

  if ((results[1]?.meta.changes ?? 0) !== 1) {
    throw conflict('An active invitation already exists for that email address.')
  }

  return {
    id,
    email,
    role: input.role,
    invitedBy: { userId: actor.id, username: actor.label, displayName: actor.label },
    createdAt: timestamp,
    expiresAt,
  }
}

export async function revokePageInvitation(
  db: D1Database,
  page: PageRow,
  actor: ActorInfo,
  invitationId: string,
  auditor: Auditor,
): Promise<void> {
  if (actor.id !== page.user_id) throw notFound('Page')
  const invitation = await db.prepare(
    `SELECT id, email, role FROM page_invitations
      WHERE id = ? AND page_id = ? AND accepted_at IS NULL AND revoked_at IS NULL
      LIMIT 1`,
  ).bind(invitationId, page.id).first<Pick<InvitationRow, 'id' | 'email' | 'role'>>()
  if (!invitation) throw notFound('Page invitation')

  const timestamp = now()
  const entry = auditor.claim({
    action: 'page.invitation.revoke',
    targetType: 'page',
    targetId: page.id,
    targetLabel: page.slug,
    before: { email: invitation.email, role: invitation.role },
    metadata: { invitationId },
  })
  const results = await db.batch([
    db.prepare(
      `UPDATE page_invitations SET revoked_at = ?
        WHERE id = ? AND page_id = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    ).bind(timestamp, invitationId, page.id),
    auditInsertStmt(db, entry, true),
  ])
  if ((results[0]?.meta.changes ?? 0) !== 1) throw notFound('Page invitation')
}

export async function updatePageMemberRole(
  db: D1Database,
  page: PageRow,
  actor: ActorInfo,
  userId: string,
  role: 'viewer' | 'editor',
  auditor: Auditor,
): Promise<ReturnType<typeof memberDto>> {
  if (actor.id !== page.user_id) throw notFound('Page')
  const member = await db.prepare(
    `SELECT u.id AS user_id, u.email, u.username, u.display_name, pm.role, pm.created_at
       FROM page_members pm JOIN users u ON u.id = pm.user_id
      WHERE pm.page_id = ? AND pm.user_id = ? LIMIT 1`,
  ).bind(page.id, userId).first<MemberRow>()
  if (!member) throw notFound('Page member')
  if (member.role === role) return memberDto(member, role)

  const timestamp = now()
  const entry = auditor.claim({
    action: 'page.member.role_change',
    targetType: 'page',
    targetId: page.id,
    targetLabel: page.slug,
    before: { userId, role: member.role },
    after: { userId, role },
  })
  const results = await db.batch([
    db.prepare(
      'UPDATE page_members SET role = ?, updated_at = ? WHERE page_id = ? AND user_id = ?',
    ).bind(role, timestamp, page.id, userId),
    auditInsertStmt(db, entry, true),
  ])
  if ((results[0]?.meta.changes ?? 0) !== 1) throw notFound('Page member')
  return memberDto({ ...member, role }, role)
}

export async function removePageMember(
  db: D1Database,
  page: PageRow,
  actor: ActorInfo,
  userId: string,
  auditor: Auditor,
): Promise<void> {
  if (actor.id !== page.user_id) throw notFound('Page')
  const member = await db.prepare(
    `SELECT u.email, u.username, pm.role FROM page_members pm
       JOIN users u ON u.id = pm.user_id
      WHERE pm.page_id = ? AND pm.user_id = ? LIMIT 1`,
  ).bind(page.id, userId).first<{ email: string; username: string; role: 'viewer' | 'editor' }>()
  if (!member) throw notFound('Page member')

  const entry = auditor.claim({
    action: 'page.member.remove',
    targetType: 'page',
    targetId: page.id,
    targetLabel: page.slug,
    before: { userId, email: member.email, role: member.role },
  })
  const results = await db.batch([
    db.prepare('DELETE FROM page_members WHERE page_id = ? AND user_id = ?')
      .bind(page.id, userId),
    auditInsertStmt(db, entry, true),
  ])
  if ((results[0]?.meta.changes ?? 0) !== 1) throw notFound('Page member')
}

export async function listMyPageInvitations(
  db: D1Database,
  email: string,
): Promise<Array<Record<string, unknown>>> {
  const { results } = await db.prepare(
    `SELECT i.id, i.page_id, i.email, i.role, i.invited_by, i.created_at, i.expires_at,
            p.slug AS page_slug, p.title AS page_title,
            u.username AS inviter_username, u.display_name AS inviter_display_name
       FROM page_invitations i
       JOIN pages p ON p.id = i.page_id AND p.deleted_at IS NULL
       LEFT JOIN users u ON u.id = i.invited_by
      WHERE i.email = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL
        AND i.expires_at > ?
      ORDER BY i.created_at DESC, i.id DESC`,
  ).bind(email.trim().toLowerCase(), now()).all<InvitationRow>()

  return results.map((row) => ({
    ...invitationDto(row),
    page: { id: row.page_id, slug: row.page_slug, title: row.page_title },
  }))
}

export async function acceptPageInvitation(
  db: D1Database,
  invitationId: string,
  actor: ActorInfo,
  email: string,
  auditor: Auditor,
): Promise<{ pageId: string; role: 'viewer' | 'editor' }> {
  const invitation = await db.prepare(
    `SELECT i.id, i.page_id, i.email, i.role, i.invited_by, i.created_at, i.expires_at,
            p.slug AS page_slug, p.title AS page_title, p.user_id AS page_owner_id
       FROM page_invitations i
       JOIN pages p ON p.id = i.page_id AND p.deleted_at IS NULL
      WHERE i.id = ? AND i.email = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL
        AND i.expires_at > ?
      LIMIT 1`,
  ).bind(invitationId, email.trim().toLowerCase(), now()).first<InvitationRow>()
  if (!invitation) throw notFound('Page invitation')
  if (invitation.page_owner_id === actor.id) throw conflict('The page owner already has access.')

  const member = await db.prepare(
    'SELECT 1 AS found FROM page_members WHERE page_id = ? AND user_id = ? LIMIT 1',
  ).bind(invitation.page_id, actor.id).first()
  if (member) throw conflict('You already have access to this page.')

  const timestamp = now()
  const entry = auditor.claim({
    action: 'page.invitation.accept',
    targetType: 'page',
    targetId: invitation.page_id,
    targetLabel: invitation.page_slug,
    after: { userId: actor.id, role: invitation.role, invitationId },
  })
  const results = await db.batch([
    db.prepare(
      `UPDATE page_invitations SET accepted_at = ?, accepted_by_user_id = ?
        WHERE id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL
          AND expires_at > ?`,
    ).bind(timestamp, actor.id, invitationId, email.trim().toLowerCase(), timestamp),
    db.prepare(
      `INSERT INTO page_members
         (id, page_id, user_id, role, created_by, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
    ).bind(ulid(), invitation.page_id, actor.id, invitation.role, invitation.invited_by, timestamp, timestamp),
    auditInsertStmt(db, entry, true),
  ])
  if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1) {
    throw notFound('Page invitation')
  }

  return { pageId: invitation.page_id, role: invitation.role }
}
