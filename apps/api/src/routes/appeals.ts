import { Hono } from 'hono'
import { notFound } from '../lib/errors'
import { ok } from '../lib/http'
import { requireAppealSession, requireUnimpersonated } from '../middleware/auth'
import { rateLimit } from '../middleware/rate-limit'
import { actorInfoOf } from '../services/user.service'
import { createAppeal, getAppeal, listUserAppeals } from '../services/moderation.service'
import { uploadPrivateEvidence } from '../services/private-evidence.service'
import { createAppealSchema } from '../validation/moderation.schema'
import { currentUser, readJson } from './helpers'
import type { AppEnv } from '../types'

export const appealRoutes = new Hono<AppEnv>()
const appealCreateLimit = rateLimit('appeal_create_user', { rejectThrottle: true })

appealRoutes.get('/mine', requireAppealSession, async (c) =>
  ok(c, { appeals: await listUserAppeals(c.env.DB, currentUser(c).id) }))

appealRoutes.get('/:id', requireAppealSession, async (c) => {
  const appeal = await getAppeal(c.env.DB, c.req.param('id'))
  if (appeal.user_id !== currentUser(c).id) throw notFound('Appeal')
  return ok(c, appeal)
})

appealRoutes.post('/', requireAppealSession, requireUnimpersonated, appealCreateLimit, async (c) => {
  const body = await readJson(c, createAppealSchema)
  const appeal = await createAppeal(c.env.DB, actorInfoOf(currentUser(c)), body.sanctionId, body.message, c.get('auditor'))
  return ok(c, { appeal }, { status: 201 })
})

appealRoutes.post('/:id/evidence', requireAppealSession, requireUnimpersonated, appealCreateLimit, async (c) => {
  const appeal = await getAppeal(c.env.DB, c.req.param('id'))
  const actor = actorInfoOf(currentUser(c))
  if (appeal.user_id !== actor.id) throw notFound('Appeal')
  const evidence = await uploadPrivateEvidence(c.env, 'appeal', c.req.param('id'), actor,
    new Uint8Array(await c.req.arrayBuffer()), c.req.header('content-type') ?? null, c.get('auditor'))
  return ok(c, evidence, { status: 201 })
})