import { Hono } from 'hono'
import { list, ok } from '../lib/http'
import { parsePagination } from '../lib/query'
import { readEnum, readInt } from '../lib/params'
import { requireCapability } from '../middleware/auth'
import {
  assignReport,
  decideAppeal,
  getAppeal,
  getReport,
  listContentFlags,
  listAppeals,
  listReports,
  moderatePageContent,
  reviewContentFlag,
  resolveReport,
} from '../services/moderation.service'
import { currentUser, readJson } from './helpers'
import {
  decideAppealSchema,
  moderatePageSchema,
  reportQueueFilters,
  resolveReportSchema,
  reviewContentFlagSchema,
} from '../validation/moderation.schema'
import { actorInfoOf } from '../services/user.service'
import { readPrivateEvidence, uploadPrivateEvidence } from '../services/private-evidence.service'
import type { AppEnv } from '../types'

export const moderationRoutes = new Hono<AppEnv>()

moderationRoutes.get('/', requireCapability('reports.read'), async (c) => {
  const pagination = parsePagination({ page: readInt(c, 'page'), limit: readInt(c, 'limit') })
  const status = readEnum(c, 'status', reportQueueFilters.statuses)
  const category = readEnum(c, 'category', reportQueueFilters.categories)
  const result = await listReports(c.env.DB, { status, category }, pagination)
  return list(c, result.rows, result.total, pagination)
})

moderationRoutes.get('/:id', requireCapability('reports.read'), async (c) =>
  ok(c, await getReport(c.env.DB, c.req.param('id'))))

moderationRoutes.post('/:id/evidence', requireCapability('reports.resolve'), async (c) => {
  const result = await uploadPrivateEvidence(c.env, 'report', c.req.param('id'), actorInfoOf(currentUser(c)),
    new Uint8Array(await c.req.arrayBuffer()), c.req.header('content-type') ?? null, c.get('auditor'))
  return ok(c, result, { status: 201 })
})

moderationRoutes.get('/:id/evidence', requireCapability('reports.read'), async (c) => {
  const object = await readPrivateEvidence(c.env, 'report', c.req.param('id'))
  const headers = new Headers({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-disposition': 'attachment' })
  object.writeHttpMetadata(headers)
  headers.set('cache-control', 'no-store')
  headers.set('content-disposition', 'attachment')
  return new Response(object.body, { headers })
})

moderationRoutes.post('/:id/assign', requireCapability('reports.assign'), async (c) => {
  const actor = actorInfoOf(currentUser(c))
  await assignReport(c.env.DB, c.req.param('id'), { id: actor.id, label: actor.label }, c.get('auditor'))
  return ok(c, await getReport(c.env.DB, c.req.param('id')))
})

moderationRoutes.post('/:id/resolve', requireCapability('reports.resolve'), async (c) => {
  const body = await readJson(c, resolveReportSchema)
  const actor = actorInfoOf(currentUser(c))
  await resolveReport(c.env.DB, c.req.param('id'), body.status, body.notes ?? null,
    { id: actor.id, label: actor.label }, c.get('auditor'))
  return ok(c, await getReport(c.env.DB, c.req.param('id')))
})

export const adminAppealRoutes = new Hono<AppEnv>()

adminAppealRoutes.get('/', requireCapability('appeals.read'), async (c) => {
  const pagination = parsePagination({ page: readInt(c, 'page'), limit: readInt(c, 'limit') })
  const status = readEnum(c, 'status', ['pending', 'approved', 'rejected', 'withdrawn'] as const)
  const result = await listAppeals(c.env.DB, status, pagination)
  return list(c, result.rows, result.total, pagination)
})

adminAppealRoutes.get('/:id', requireCapability('appeals.read'), async (c) =>
  ok(c, await getAppeal(c.env.DB, c.req.param('id'))))

adminAppealRoutes.post('/:id/evidence', requireCapability('appeals.decide'), async (c) => {
  const result = await uploadPrivateEvidence(c.env, 'appeal', c.req.param('id'), actorInfoOf(currentUser(c)),
    new Uint8Array(await c.req.arrayBuffer()), c.req.header('content-type') ?? null, c.get('auditor'))
  return ok(c, result, { status: 201 })
})

adminAppealRoutes.get('/:id/evidence', requireCapability('appeals.read'), async (c) => {
  const object = await readPrivateEvidence(c.env, 'appeal', c.req.param('id'))
  const headers = new Headers({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-disposition': 'attachment' })
  object.writeHttpMetadata(headers)
  headers.set('cache-control', 'no-store')
  headers.set('content-disposition', 'attachment')
  return new Response(object.body, { headers })
})

adminAppealRoutes.post('/:id/decision', requireCapability('appeals.decide'), async (c) => {
  const body = await readJson(c, decideAppealSchema)
  await decideAppeal(c.env.DB, c.req.param('id'), actorInfoOf(currentUser(c)), body.decision,
    body.notes, body.reducedDurationHours, c.get('auditor'))
  return ok(c, await getAppeal(c.env.DB, c.req.param('id')))
})

export const adminContentFlagRoutes = new Hono<AppEnv>()

adminContentFlagRoutes.get('/', requireCapability('content.read'), async (c) => {
  const pagination = parsePagination({ page: readInt(c, 'page'), limit: readInt(c, 'limit') })
  const status = readEnum(c, 'status', ['open', 'cleared', 'actioned', 'escalated'] as const)
  const result = await listContentFlags(c.env.DB, status, pagination)
  return list(c, result.rows, result.total, pagination)
})

adminContentFlagRoutes.post('/:id/review', requireCapability('content.moderate'), async (c) => {
  const body = await readJson(c, reviewContentFlagSchema)
  const actor = actorInfoOf(currentUser(c))
  await reviewContentFlag(c.env.DB, c.req.param('id'), body.status, body.notes,
    { id: actor.id, label: actor.label }, c.get('auditor'))
  return ok(c, { id: c.req.param('id'), status: body.status })
})

export const adminContentRoutes = new Hono<AppEnv>()

adminContentRoutes.post('/pages/:id/remove', requireCapability('content.moderate'), async (c) => {
  const body = await readJson(c, moderatePageSchema)
  await moderatePageContent(c.env.DB, c.req.param('id'), 'remove_content', body.reason, body.reportId ?? null,
    actorInfoOf(currentUser(c)), c.get('auditor'))
  return ok(c, { pageId: c.req.param('id'), moderationStatus: 'removed' })
})

adminContentRoutes.post('/pages/:id/restore', requireCapability('content.moderate'), async (c) => {
  const body = await readJson(c, moderatePageSchema)
  await moderatePageContent(c.env.DB, c.req.param('id'), 'restore', body.reason, body.reportId ?? null,
    actorInfoOf(currentUser(c)), c.get('auditor'))
  return ok(c, { pageId: c.req.param('id'), moderationStatus: 'visible' })
})