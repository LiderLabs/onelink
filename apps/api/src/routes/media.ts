import { Hono } from 'hono'
import { ok } from '../lib/http'
import { validationError } from '../lib/errors'
import { requireActiveAccount, requirePasswordSettled, requireUnimpersonated } from '../middleware/auth'
import { rateLimit } from '../middleware/rate-limit'
import { actorInfoOf } from '../services/user.service'
import { getCurrentAvatar, readPublicAvatar, uploadAvatar } from '../services/media.service'
import type { AppEnv } from '../types'
import { currentUser } from './helpers'

export const mediaRoutes = new Hono<AppEnv>()

mediaRoutes.post('/', requireActiveAccount, requirePasswordSettled, requireUnimpersonated, rateLimit('media_upload_user', { rejectThrottle: true }), async c => {
  const query = c.req.query()
  if (query.kind !== 'avatar' || Object.keys(query).some(key => key !== 'kind')) throw validationError('Choose a supported photo type.')
  const bytes = new Uint8Array(await c.req.arrayBuffer())
  const media = await uploadAvatar(c.env, actorInfoOf(currentUser(c)), bytes, c.req.header('content-type') ?? '', c.get('auditor'))
  return ok(c, media, { status: 201 })
})

mediaRoutes.get('/avatar', requireActiveAccount, requirePasswordSettled, async c =>
  ok(c, { media: await getCurrentAvatar(c.env.DB, currentUser(c).id) }))

mediaRoutes.get('/files/avatars/:ownerId/:filename', async c => {
  const object = await readPublicAvatar(c.env, `avatars/${c.req.param('ownerId')}/${c.req.param('filename')}`)
  return c.body(object.body, 200, { 'content-type': 'image/webp', etag: object.httpEtag, 'cache-control': 'no-store' })
})
