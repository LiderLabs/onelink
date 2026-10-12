import assert from 'node:assert/strict'
import { chromium } from 'playwright'

// Checks the real admin screens at the API boundary. A repeated sanction, an
// owner-draft write, wrong snake_case handling, or a false success must fail.
const origin = process.env.BASE_URL ?? 'http://localhost:5173'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
page.setDefaultTimeout(12000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
const actorId = '01K00000000000000000000001'
const targetId = '01K00000000000000000000002'
const pageId = '01K00000000000000000000003'
const reportId = '01K00000000000000000000004'
const appealId = '01K00000000000000000000005'
const now = Date.now()
let role = 'moderator'
let denied = false
let resolutionFails = false
let targetRole = 'user'
let mutationDelay = 0
let report = {}
let appeal = {}
const writes = []
const reads = []
const user = (id, userRole = 'user') => ({ id, role: userRole, username: id === actorId ? 'staff' : 'creator', email: 'creator@example.test', displayName: 'Creator', bio: null, location: null, pronouns: null, avatarKey: null, avatarUrl: null, status: 'active', statusReason: null, suspendedUntil: null, suspendedPermanently: false, emailVerified: true, requirePasswordChange: false, lastLoginAt: now, loginCount: 1, createdAt: now, updatedAt: now, deletedAt: null })
function reset() {
  report = { id: reportId, target_type: 'link', target_id: '01K00000000000000000000006', page_id: pageId, target_snapshot: JSON.stringify({ target: { type: 'link', id: '01K00000000000000000000006', title: 'Reported link', url: 'https://example.test/unsafe' }, page: { slug: 'creator', title: 'Creator page', bio: 'Stored evidence', owner: { username: 'creator', displayName: 'Creator' } }, links: [] }), reporter_user_id: null, reporter_label: 'Concerned reader', reporter_email: 'reader@example.test', reporter_ip: '192.0.2.10', category: 'malware', description: 'This link installs unwanted software.', status: 'open', priority: 3, assigned_admin_id: null, resolution_action: null, resolved_by: null, resolved_by_label: null, resolved_at: null, created_at: now, updated_at: now, actions: [] }
  appeal = { id: appealId, user_id: targetId, sanction_id: '01K00000000000000000000007', message: 'I have fixed my page and request a shorter suspension.', attempt: 1, status: 'pending', reviewed_at: null, reviewed_by: null, reviewed_by_label: null, decision: null, decision_notes: null, created_at: now, username: 'creator', email: 'creator@example.test', sanction_type: 'suspend', sanction_reason: 'Malware links', sanction_status: 'active', duration_hours: 48, expires_at: now + 48 * 3600000 }
  writes.length = 0
  reads.length = 0
  denied = false
  resolutionFails = false
  targetRole = 'user'
  mutationDelay = 0
}
reset()
await page.route('**/api/v1/**', async route => {
  const request = route.request()
  const url = new URL(request.url())
  const path = url.pathname.replace('/api/v1', '')
  const method = request.method()
  const send = (data, status = 200) => route.fulfill({ status, json: { data } })
  const fail = (message, status = 403) => route.fulfill({ status, json: { error: { code: status === 403 ? 'FORBIDDEN' : 'INTERNAL', message } } })
  if (method !== 'GET') {
    writes.push({ path, body: request.postDataJSON() })
    if (mutationDelay) await new Promise(resolve => setTimeout(resolve, mutationDelay))
  }
  else reads.push(url.pathname + url.search)
  if (path === '/public/settings') return send({ platformName: 'OneLink', roles: [], settings: {} })
  if (path === '/auth/me') return send({ user: { ...user(actorId, role), sessionId: 'fixture', sessionExpiresAt: now + 3600000, impersonatedBy: null }, capabilities: role === 'support' ? ['users.read', 'reports.read', 'appeals.read'] : ['users.read', 'reports.read', 'reports.assign', 'reports.resolve', 'content.moderate', 'users.sanction', 'appeals.read', 'appeals.decide'], platformName: 'OneLink', serverTime: now })
  if (path === '/admin/reports' || path === '/admin/appeals') {
    const row = path.endsWith('reports') ? report : appeal
    const status = url.searchParams.get('status')
    const items = status && status !== row.status ? [] : [row]
    return route.fulfill({ json: { data: items, meta: { page: Number(url.searchParams.get('page') ?? 1), limit: 20, total: items.length, totalPages: items.length ? 1 : 0 } } })
  }
  if (path === `/admin/reports/${reportId}`) return send(report)
  if (path === `/admin/appeals/${appealId}`) return send(appeal)
  if (path === '/admin/users' && method === 'GET') return route.fulfill({ json: { data: [user(targetId, targetRole)], meta: { page: 1, limit: 100, total: 1, totalPages: 1 } } })
  if (path === `/admin/users/${targetId}`) return send({ user: user(targetId, targetRole), counts: { pages: 1, sessions: 0, sanctions: 1, notes: 0, reportsAgainst: 1, reportsFiled: 0 }, sanctions: [] })
  if (denied && method !== 'GET') return fail('The account rank changed. You cannot moderate this account.')
  if (path === `/admin/reports/${reportId}/resolve`) {
    if (resolutionFails) return fail('Report resolution temporarily unavailable.', 503)
    report.status = request.postDataJSON().status
    return send(report)
  }
  if (path === `/admin/reports/${reportId}/assign`) { report.status = 'reviewing'; report.assigned_admin_id = actorId; return send(report) }
  if (path === `/admin/content/pages/${pageId}/remove`) return send({ pageId, moderationStatus: 'removed' })
  if (path === `/admin/users/${targetId}/warn` || path === `/admin/users/${targetId}/ban`) return send({ sanction: { id: 'fixture-sanction', type: path.endsWith('warn') ? 'warn' : 'ban', expiresAt: null } })
  if (path === `/admin/appeals/${appealId}/decision`) { appeal.status = request.postDataJSON().decision === 'uphold' ? 'rejected' : 'approved'; appeal.decision = request.postDataJSON().decision; return send(appeal) }
  return fail(`Unexpected fixture request: ${method} ${path}`, 503)
})
async function openReport() {
  await page.goto(`${origin}/admin/reports`)
  await page.getByRole('heading', { name: 'Reports', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Review report', exact: true }).first().click()
  await page.getByText('This link installs unwanted software.', { exact: true }).waitFor()
}
async function confirmReport(action, reason) {
  await page.getByRole('button', { name: action, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: /Reason|Notes/ }).fill(reason)
  await dialog.getByRole('button', { name: action, exact: true }).click()
}
async function fits(label) {
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label} fits ${width}px`)
  }
  await page.setViewportSize({ width: 1280, height: 900 })
}
try {
  await openReport()
  assert.equal(await page.getByRole('link', { name: 'Open public page' }).getAttribute('href'), '/p/creator')
  await page.getByText(/Specific-link removal is unavailable/).waitFor()
  await page.getByRole('button', { name: 'Warn user', exact: true }).waitFor()
  assert.ok(reads.some(path => path.includes('/admin/users?') && path.includes('q=creator')), 'Username-only snapshots must resolve an exact owner account')
  await fits('Reports')
  await page.getByRole('button', { name: 'Assign to me', exact: true }).click()
  await page.getByText('Report assigned to you.', { exact: true }).waitFor()
  assert.deepEqual(writes.shift(), { path: `/admin/reports/${reportId}/assign`, body: null })
  await confirmReport('Dismiss report', 'No policy violation found')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.deepEqual(writes[0], { path: `/admin/reports/${reportId}/resolve`, body: { status: 'dismissed', notes: 'No policy violation found' } })

  reset()
  await openReport()
  resolutionFails = true
  await page.getByRole('button', { name: 'Remove entire page', exact: true }).click()
  const removal = page.getByRole('dialog')
  await removal.getByText(/ENTIRE PAGE.*every link/).waitFor()
  await removal.getByRole('textbox', { name: 'Reason' }).fill('Confirmed malicious content')
  mutationDelay = 500
  await removal.getByRole('button', { name: 'Remove entire page', exact: true }).click()
  await page.keyboard.press('Escape')
  assert.equal(await removal.isVisible(), true, 'Pending confirmation must resist Escape')
  await page.getByText(/Page removed.*report.*resolution|Page removed.*report.*could not/i).waitFor()
  assert.deepEqual(writes[0], { path: `/admin/content/pages/${pageId}/remove`, body: { reason: 'Confirmed malicious content', reportId } })
  assert.equal(writes.filter(write => write.path.endsWith('/remove')).length, 1)
  resolutionFails = false
  await page.getByRole('button', { name: 'Retry report resolution', exact: true }).click()
  await page.getByText(/Report resolved/i).first().waitFor()
  assert.equal(writes.filter(write => write.path.endsWith('/remove')).length, 1, 'Retry must never repeat removal')
  assert.equal(writes.filter(write => write.path.endsWith('/resolve')).length, 2)

  reset()
  report.target_type = 'user'; report.target_id = targetId
  await openReport()
  denied = true
  await confirmReport('Ban user', 'Repeated malicious content')
  await page.getByText('The account rank changed. You cannot moderate this account.', { exact: true }).waitFor()
  assert.deepEqual(writes[0], { path: `/admin/users/${targetId}/ban`, body: { reason: 'Repeated malicious content', category: 'malware', reportId } })
  assert.equal(writes.some(write => write.path.endsWith('/resolve')), false, 'Denied sanction must not resolve report')

  reset()
  await page.goto(`${origin}/admin/appeals`)
  await page.getByRole('heading', { name: 'Appeals', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Review appeal', exact: true }).click()
  await page.getByText(appeal.message, { exact: true }).waitFor()
  await fits('Appeals')
  await page.getByRole('button', { name: 'Reduce suspension', exact: true }).click()
  const decision = page.getByRole('dialog')
  await decision.getByRole('textbox', { name: 'Decision notes' }).fill('Content corrected; shorter suspension warranted')
  await decision.getByRole('spinbutton', { name: 'Reduced duration in hours' }).fill('48')
  await decision.getByRole('button', { name: 'Reduce suspension', exact: true }).click()
  assert.equal(writes.length, 0, 'Non-shorter duration must not reach API')
  await decision.getByRole('spinbutton', { name: 'Reduced duration in hours' }).fill('24')
  await decision.getByRole('button', { name: 'Reduce suspension', exact: true }).click()
  await decision.waitFor({ state: 'hidden' })
  assert.deepEqual(writes[0], { path: `/admin/appeals/${appealId}/decision`, body: { decision: 'reduce', notes: 'Content corrected; shorter suspension warranted', reducedDurationHours: 24 } })

  reset()
  await page.goto(`${origin}/admin/appeals`)
  await page.getByRole('button', { name: 'Review appeal', exact: true }).click()
  await page.getByRole('button', { name: 'Overturn sanction', exact: true }).click()
  denied = true
  const refused = page.getByRole('dialog')
  await refused.getByRole('textbox', { name: 'Decision notes' }).fill('Sanction issued in error')
  await refused.getByRole('button', { name: 'Overturn sanction', exact: true }).click()
  await refused.getByText('The account rank changed. You cannot moderate this account.', { exact: true }).waitFor()
  assert.equal(appeal.status, 'pending', 'Backend refusal must keep appeal pending')
  assert.deepEqual(writes[0], { path: `/admin/appeals/${appealId}/decision`, body: { decision: 'overturn', notes: 'Sanction issued in error' } })

  reset(); targetRole = 'moderator'
  await page.goto(`${origin}/admin/appeals`)
  await page.getByRole('button', { name: 'Review appeal', exact: true }).click()
  await page.getByText(/cannot decide an appeal.*at or above your rank/).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Uphold sanction', exact: true }).count(), 0)

  reset(); role = 'support'
  await openReport()
  assert.equal(await page.getByRole('button', { name: 'Dismiss report', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Remove entire page', exact: true }).count(), 0)
  await page.goto(`${origin}/admin/appeals`)
  await page.getByRole('button', { name: 'Review appeal', exact: true }).click()
  await page.getByText(appeal.message, { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Uphold sanction', exact: true }).count(), 0)
  assert.deepEqual(writes, [])
  assert.deepEqual(errors, [])
  console.log('PASS admin moderation: raw DTOs, safe stored public link, assignment/dismissal payloads, whole-page confirmation, pending Escape lock, partial resolution retry without repeat, report and appeal backend denial, reduce validation/payload, known-rank guard, support read-only, mobile fit')
} catch (error) {
  console.error('Moderation diagnostics:', page.url(), await page.locator('body').innerText({ timeout: 2000 }).catch(() => ''), errors)
  console.error('Dialog geometry:', await page.locator('dialog[open]').evaluateAll(dialogs => dialogs.map(dialog => ({ scrollTop: dialog.scrollTop, height: dialog.clientHeight, scrollHeight: dialog.scrollHeight, rect: dialog.getBoundingClientRect().toJSON(), buttons: [...dialog.querySelectorAll('button')].map(button => ({ text: button.textContent, rect: button.getBoundingClientRect().toJSON(), display: getComputedStyle(button).display, visibility: getComputedStyle(button).visibility })) }))))
  throw error
} finally { await browser.close() }
