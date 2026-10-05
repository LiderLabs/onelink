import { createMiddleware } from 'hono/factory'
import { ulid } from '../lib/ids'
import type { AppEnv } from '../types'

export const REQUEST_ID_HEADER = 'x-request-id'

const SAFE_INCOMING_ID = /^[A-Za-z0-9._:-]{8,64}$/

/**
 * Assigns every request a correlation id.
 *
 * An inbound `x-request-id` is honoured only if it matches a strict shape —
 * otherwise a client could inject newlines or arbitrary content into logs and
 * into the audit trail.
 */
export const requestIdMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const incoming = c.req.header(REQUEST_ID_HEADER)
  const id = incoming && SAFE_INCOMING_ID.test(incoming) ? incoming : ulid()
  c.set('requestId', id)
  c.header(REQUEST_ID_HEADER, id)
  await next()
})
