import type {
  ApiUser,
  AuthUser,
  SanctionRow,
  SessionRow,
  UserNoteRow,
  UserRow,
} from '../types'

// ============================================================================
// Row -> DTO mapping. Kept in one place so every endpoint exposes the same
// shape for the same concept, and so it is obvious that `password_hash` and
// `password_reset_tokens` never appear in any DTO.
// ============================================================================

export function toApiUser(row: UserRow): ApiUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name ?? row.username,
    bio: row.bio,
    avatarKey: row.avatar_key,
    role: row.role,
    status: row.status,
    statusReason: row.status_reason,
    suspendedUntil: row.suspended_until,
    suspendedPermanently: row.suspended_permanently === 1,
    emailVerified: row.email_verified === 1,
    requirePasswordChange: row.require_password_change === 1,
    lastLoginAt: row.last_login_at,
    loginCount: row.login_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }
}

export function toAuthUser(row: UserRow, session: SessionRow): AuthUser {
  return {
    ...toApiUser(row),
    sessionId: session.id,
    sessionExpiresAt: session.expires_at,
    impersonatedBy: session.impersonated_by,
  }
}

export function toSessionDto(row: SessionRow): {
  id: string
  createdAt: number
  lastUsedAt: number | null
  expiresAt: number
  ip: string | null
  userAgent: string | null
  deviceLabel: string | null
  impersonatedBy: string | null
  revokedAt: number | null
  revokedReason: string | null
} {
  return {
    id: row.id,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    ip: row.ip,
    userAgent: row.user_agent,
    deviceLabel: row.device_label,
    impersonatedBy: row.impersonated_by,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
  }
}

export function toSanctionDto(row: SanctionRow): Record<string, unknown> {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    reason: row.reason,
    category: row.category,
    issuedBy: row.issued_by,
    issuedByLabel: row.issued_by_label,
    reportId: row.report_id,
    durationHours: row.duration_hours,
    expiresAt: row.expires_at,
    status: row.status,
    liftedBy: row.lifted_by,
    liftedAt: row.lifted_at,
    liftReason: row.lift_reason,
    createdAt: row.created_at,
  }
}

export function toNoteDto(row: UserNoteRow): Record<string, unknown> {
  return {
    id: row.id,
    userId: row.user_id,
    authorId: row.author_id,
    authorLabel: row.author_label,
    body: row.body,
    createdAt: row.created_at,
  }
}

/** Narrow shape used inside list responses and nested references. */
export function toUserSummary(row: {
  id: string
  username: string
  display_name?: string | null
  role?: string | null
  status?: string | null
}): Record<string, unknown> {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name ?? row.username,
    role: row.role ?? null,
    status: row.status ?? null,
  }
}
