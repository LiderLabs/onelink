import { Hono } from 'hono'
import { appConfig } from '../lib/config'
import { noContent, ok } from '../lib/http'
import {
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
} from '../middleware/auth'
import { rateLimit } from '../middleware/rate-limit'
import {
  acceptPageInvitation,
  createPageInvitation,
  listMyPageInvitations,
  listPageInvitations,
  listPageMembers,
  removePageMember,
  revokePageInvitation,
  updatePageMemberRole,
} from '../services/page-member.service'
import { actorInfoOf } from '../services/user.service'
import { getSettingsMap, platformNameOf } from '../services/settings.service'
import { queueEmail } from '../services/email.service'
import { requirePageAccess } from '../services/page-access.service'
import { currentUser, readJson } from './helpers'
import {
  createPageInvitationSchema,
  pageMemberRoleSchema,
} from '../validation/page-member.schema'
import type { AppEnv } from '../types'

const writeLimit = rateLimit('pages_write_user')

export const pageMemberRoutes = new Hono<AppEnv>()

pageMemberRoutes.get(
  '/:id/members',
  requireActiveAccount,
  requirePasswordSettled,
  async (c) => {
    const { page } = await requirePageAccess(
      c.env.DB,
      actorInfoOf(currentUser(c)),
      c.req.param('id'),
      'viewer',
    )
    return ok(c, { members: await listPageMembers(c.env.DB, page) })
  },
)

pageMemberRoutes.get(
  '/:id/invitations',
  requireActiveAccount,
  requirePasswordSettled,
  async (c) => {
    const { page } = await requirePageAccess(
      c.env.DB,
      actorInfoOf(currentUser(c)),
      c.req.param('id'),
    )
    return ok(c, { invitations: await listPageInvitations(c.env.DB, page.id) })
  },
)

pageMemberRoutes.post(
  '/:id/invitations',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const user = currentUser(c)
    const actor = actorInfoOf(user)
    const { page } = await requirePageAccess(c.env.DB, actor, c.req.param('id'))
    const body = await readJson(c, createPageInvitationSchema)
    const invitation = await createPageInvitation(c.env.DB, page, actor, body, c.get('auditor'))

    const inviteUrl = new URL('/app/invitations', appConfig(c.env).appOrigin)
    inviteUrl.searchParams.set('invitation', invitation.id)
    const settings = await getSettingsMap(c.env.DB)
    await queueEmail(c.env.DB, {
      to: invitation.email,
      templateKey: 'page_invitation',
      variables: {
        platform_name: platformNameOf(settings),
        inviter_name: actor.label,
        page_name: page.title ?? page.slug,
        role: invitation.role,
        invite_url: inviteUrl.toString(),
        expires_in: '7 days',
      },
    })

    return ok(c, { invitation }, { status: 201 })
  },
)

pageMemberRoutes.delete(
  '/:id/invitations/:invitationId',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const actor = actorInfoOf(currentUser(c))
    const { page } = await requirePageAccess(c.env.DB, actor, c.req.param('id'))
    await revokePageInvitation(
      c.env.DB,
      page,
      actor,
      c.req.param('invitationId'),
      c.get('auditor'),
    )
    return noContent(c)
  },
)

pageMemberRoutes.patch(
  '/:id/members/:userId',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const actor = actorInfoOf(currentUser(c))
    const { page } = await requirePageAccess(c.env.DB, actor, c.req.param('id'))
    const body = await readJson(c, pageMemberRoleSchema)
    return ok(c, {
      member: await updatePageMemberRole(
        c.env.DB,
        page,
        actor,
        c.req.param('userId'),
        body.role,
        c.get('auditor'),
      ),
    })
  },
)

pageMemberRoutes.delete(
  '/:id/members/:userId',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const actor = actorInfoOf(currentUser(c))
    const { page } = await requirePageAccess(c.env.DB, actor, c.req.param('id'))
    await removePageMember(c.env.DB, page, actor, c.req.param('userId'), c.get('auditor'))
    return noContent(c)
  },
)

export const pageInvitationRoutes = new Hono<AppEnv>()

pageInvitationRoutes.get(
  '/',
  requireActiveAccount,
  requirePasswordSettled,
  async (c) => {
    const user = currentUser(c)
    return ok(c, { invitations: await listMyPageInvitations(c.env.DB, user.email) })
  },
)

pageInvitationRoutes.post(
  '/:id/accept',
  writeLimit,
  requireActiveAccount,
  requirePasswordSettled,
  requireUnimpersonated,
  async (c) => {
    const user = currentUser(c)
    const accepted = await acceptPageInvitation(
      c.env.DB,
      c.req.param('id'),
      actorInfoOf(user),
      user.email,
      c.get('auditor'),
    )
    return ok(c, { invitation: { accepted: true, ...accepted } })
  },
)
