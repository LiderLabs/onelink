import { ROLE_RANK, STAFF_ROLES, type Role } from './constants'
import { forbidden } from './errors'

// ============================================================================
// Authorisation.
//
// Two layers, deliberately separate:
//
//   1. Capability grants — "may this ROLE reach this feature area at all?"
//      (coarse, role -> capability table below)
//
//   2. Rank rules — "may this ACTOR touch this particular ROW?"
//      (fine-grained; a moderator must outrank the user they are sanctioning,
//       and peers can never sanction each other)
//
// Keeping (2) as pure functions over `{ id, role }` means every rule is
// unit-testable without a database.
// ============================================================================

export const CAPABILITIES = [
  'users.read',
  'users.create',
  'users.update',
  'users.delete',
  'users.role.assign',
  'users.sanction',
  'users.impersonate',
  'users.sessions.revoke',
  'users.password.reset',
  'users.notes.read',
  'users.notes.write',
  'reports.read',
  'reports.assign',
  'reports.resolve',
  'content.read',
  'content.moderate',
  'appeals.read',
  'appeals.decide',
  'settings.read',
  'settings.update',
  'audit.read',
  'media.read',
  'media.delete',
] as const

export type Capability = (typeof CAPABILITIES)[number]

const ALL_CAPABILITIES: readonly Capability[] = CAPABILITIES

const MODERATOR_CAPABILITIES: readonly Capability[] = [
  'users.read',
  'users.sanction',
  'users.sessions.revoke',
  'users.password.reset',
  'users.notes.read',
  'users.notes.write',
  'reports.read',
  'reports.assign',
  'reports.resolve',
  'content.read',
  'content.moderate',
  'appeals.read',
  'appeals.decide',
  'media.read',
]

const SUPPORT_CAPABILITIES: readonly Capability[] = [
  'users.read',
  'users.notes.read',
  'users.notes.write',
  'reports.read',
  'content.read',
  'appeals.read',
  'media.read',
]

/**
 * Owner holds every capability. Admin holds everything EXCEPT:
 *
 *   settings.update     — changing platform policy is the owner's call
 *   users.role.assign   — deciding who is staff is likewise the owner's call
 *
 * Those two splits are what make "owner" mean something more than "admin".
 * Note that `assertCanGrantRole` independently prevents ANY actor from granting
 * a role at or above their own rank, so even an owner cannot mint a second
 * owner by accident.
 */
const GRANTS: Record<Role, readonly Capability[]> = {
  owner: ALL_CAPABILITIES,
  admin: ALL_CAPABILITIES.filter(
    (capability) => capability !== 'settings.update' && capability !== 'users.role.assign',
  ),
  moderator: MODERATOR_CAPABILITIES,
  support: SUPPORT_CAPABILITIES,
  user: [],
}

export function isStaff(role: Role): boolean {
  return (STAFF_ROLES as readonly string[]).includes(role)
}

export function can(role: Role, capability: Capability): boolean {
  return GRANTS[role].includes(capability)
}

export function capabilitiesOf(role: Role): readonly Capability[] {
  return GRANTS[role]
}

// -------------------------------------------------------------- rank rules --

export interface Actor {
  id: string
  role: Role
}

export interface Target {
  id: string
  role: Role
}

export function rank(role: Role): number {
  return ROLE_RANK[role]
}

/** True when `actor` is strictly more senior than `target`. */
export function outranks(actor: Actor, target: Target): boolean {
  return rank(actor.role) > rank(target.role)
}

/** Non-destructive changes: equal rank is enough (owner peers may edit each other). */
export function assertCanEditUser(actor: Actor, target: Target): void {
  if (!isStaff(actor.role)) throw forbidden('Only staff can modify accounts.')
  if (rank(actor.role) < rank(target.role)) {
    throw forbidden('You cannot modify an account more senior than your own.')
  }
}

/**
 * Destructive changes (sanction, delete, revoke-all-sessions).
 *
 * Strictly senior, so two moderators cannot sanction each other — except
 * owner-on-owner, which is permitted because owner is the top rank and a
 * single-tenant platform may legitimately have several owners who need to be
 * able to remove a rogue one.
 */
export function assertCanModerateUser(actor: Actor, target: Target): void {
  if (!isStaff(actor.role)) throw forbidden('Only staff can moderate accounts.')
  if (actor.id === target.id) {
    throw forbidden('You cannot moderate your own account.')
  }
  if (actor.role === 'owner' && target.role === 'owner') return
  if (!outranks(actor, target)) {
    throw forbidden('You cannot moderate an account at or above your own rank.')
  }
}

/** You may never grant a role at or above your own rank. */
export function assertCanGrantRole(actor: Actor, newRole: Role): void {
  if (rank(newRole) >= rank(actor.role)) {
    throw forbidden('You cannot grant a role at or above your own rank.')
  }
}

// --------------------------------------------------------------- own data ----

export function assertStaff(role: Role): void {
  if (!isStaff(role)) throw forbidden('Staff access required.')
}

/** Convenience guard used by every /admin route. */
export function authorize(role: Role, capability: Capability): void {
  if (!can(role, capability)) {
    throw forbidden(`Missing capability: ${capability}.`)
  }
}
