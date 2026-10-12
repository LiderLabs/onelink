import assert from 'node:assert/strict'
import { chromium } from 'playwright'

// Every API request is intercepted. This check never changes real accounts.
const origin = process.env.BASE_URL ?? 'http://localhost:5173'
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
page.setDefaultTimeout(12000)
const errors = []
const reads = []
const writes = []
page.on('pageerror', error => errors.push(error.message))
const now = Date.now()
const base = { bio: null, location: null, pronouns: null, avatarKey: null, avatarUrl: null, status: 'active', statusReason: null, suspendedUntil: null, suspendedPermanently: false, emailVerified: true, requirePasswordChange: false, lastLoginAt: now - 60000, loginCount: 8, createdAt: now - 86400000, updatedAt: now, deletedAt: null }
const actor = { ...base, id: 'actor', email: 'owner@example.test', username: 'owner-account', displayName: 'Owner Self', role: 'owner', sessionId: 'session-actor', sessionExpiresAt: now + 3600000, impersonatedBy: null }
const users = [
  { ...base, id: 'creator', email: 'avery@example.test', username: 'account-avery', displayName: 'Avery Creator', role: 'user' },
  { ...base, id: 'owner-peer', email: 'peer@example.test', username: 'owner-peer', displayName: 'Owner Peer', role: 'owner' },
  actor,
]
const allCaps = ['users.read', 'users.create', 'users.update', 'users.delete', 'users.role.assign', 'users.sanction', 'users.impersonate', 'users.sessions.revoke', 'users.password.reset', 'users.notes.read', 'users.notes.write', 'reports.read', 'reports.assign', 'reports.resolve', 'content.read', 'content.moderate', 'appeals.read', 'appeals.decide', 'settings.read', 'settings.update', 'audit.read']
let role = 'owner'
let holdWrite = null
let releaseWrite = null
let releaseSearch = null
let releaseDetail = null
let holdDetail = false
let creatorSessionsRevoked = false
let noteRows = [{ id: 'note-1', userId: 'creator', authorId: 'actor', authorLabel: 'Owner Self', body: 'Fixture account note.', createdAt: now }]
const detail = user => ({ user, counts: { pages: 2, sessions: 1, sanctions: user.status === 'suspended' ? 1 : 0, notes: noteRows.length, reportsAgainst: 3, reportsFiled: 1 }, sanctions: user.status === 'suspended' ? [{ id: 'sanction-1', type: 'suspend', reason: user.statusReason, issuedByLabel: 'Owner Self', createdAt: now, expiresAt: now + 172800000, status: 'active' }] : [] })
await page.route('**/api/v1/**', async route => {
  const request = route.request()
  const url = new URL(request.url())
  const path = url.pathname.replace('/api/v1', '')
  const method = request.method()
  const payload = request.postData() ? request.postDataJSON() : null
  const ok = data => route.fulfill({ json: { data } })
  const list = (items, total = items.length, limit = 20) => route.fulfill({ json: { data: items, meta: { page: Number(url.searchParams.get('page') ?? 1), limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } } })
  if (method !== 'GET') writes.push({ path, method, payload, search: url.search })
  if (path === '/public/settings') return ok({ platformName: 'OneLink', settings: {}, roles: [] })
  if (path === '/auth/me') return ok({ user: { ...actor, role }, capabilities: role === 'owner' ? allCaps : ['users.read', 'users.notes.read', 'users.notes.write', 'reports.read', 'content.read', 'appeals.read'], platformName: 'OneLink', serverTime: now })
  if (path === '/admin/users' && method === 'GET') {
    reads.push(Object.fromEntries(url.searchParams))
    if (url.searchParams.get('q') === 'slow') { await new Promise(resolve => { const earlier = releaseSearch; releaseSearch = () => { earlier?.(); resolve() } }); return list([{ ...users[0], id: 'stale', displayName: 'Stale Search Result' }], 1) }
    return list(users, 52)
  }
  if (path === '/admin/users' && method === 'POST') {
    if (holdWrite === 'create') await new Promise(resolve => { releaseWrite = resolve })
    return ok({ ...base, ...payload, id: 'created', username: payload.username ?? 'new-user', displayName: payload.displayName ?? 'new-user' })
  }
  const match = path.match(/^\/admin\/users\/([^/]+)(?:\/(.*))?$/)
  if (match) {
    const user = users.find(item => item.id === match[1])
    const action = match[2]
    if (!user) return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'User not found.' } } })
    if (!action && method === 'GET') { if (holdDetail && user.id === 'owner-peer') await new Promise(resolve => { releaseDetail = resolve }); return ok(detail(user)) }
    if (!action && method === 'PATCH') { Object.assign(user, payload); return ok(user) }
    if (action === 'notes' && method === 'GET') return list(noteRows)
    if (action === 'notes' && method === 'POST') { const note = { id: 'note-2', userId: user.id, authorLabel: 'Owner Self', body: payload.body, createdAt: now }; noteRows = [note, ...noteRows]; return ok(note) }
    if (action === 'sessions' && method === 'GET') return ok({ sessions: creatorSessionsRevoked && user.id === 'creator' ? [] : [{ id: 'session-1', createdAt: now - 100000, lastUsedAt: now - 60000, expiresAt: now + 3600000, ip: '192.0.2.1', userAgent: 'Fixture Chrome', deviceLabel: 'Chrome on desktop', impersonatedBy: null, revokedAt: null, revokedReason: null }] })
    if (action === 'sessions' && method === 'DELETE') { creatorSessionsRevoked = true; return ok({ revoked: 1 }) }
    if (user.id === 'owner-peer' && ['suspend', 'ban'].includes(action)) return route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN', message: 'This is the last active owner; promote another owner first.' } } })
    if (action === 'suspend') { user.status = 'suspended'; user.statusReason = payload.reason; return ok({ sanction: { id: 'sanction-1', expiresAt: now + payload.durationHours * 3600000, revokedSessions: 1, user } }) }
    if (action === 'warn') return ok({ sanction: { id: 'warning-1', expiresAt: null, revokedSessions: 0, user } })
    if (action === 'ban') { user.status = 'banned'; return ok({ sanction: { id: 'ban-1', revokedSessions: 1, user } }) }
    if (action === 'reactivate') { user.status = 'active'; return ok({ user, liftedSanctions: 1 }) }
    if (!action && method === 'DELETE') { user.status = 'deleted'; return ok({ sanction: { id: 'delete-1', revokedSessions: 1, user } }) }
  }
  return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: `Unexpected fixture API request: ${method} ${path}` } } })
})
const dialog = name => page.getByRole('dialog', { name, exact: true })
async function eventually(condition, message) {
  for (let attempt = 0; attempt < 100; attempt++) { if (condition()) return; await page.waitForTimeout(50) }
  assert.fail(message)
}
async function fits(label) {
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label} overflow at ${width}px`)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
}
try {
  await page.goto(`${origin}/admin/users`)
  await page.getByRole('heading', { name: 'Users', exact: true }).waitFor({ timeout: 6000 })
  await page.getByRole('button', { name: 'View Avery Creator', exact: true }).waitFor()
  await fits('Users list')
  await page.getByRole('searchbox', { name: 'Search users', exact: true }).fill('slow')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await eventually(() => releaseSearch, 'Slow search must be pending')
  await page.getByRole('combobox', { name: 'Role filter', exact: true }).selectOption('support')
  await page.getByRole('searchbox', { name: 'Search users', exact: true }).fill('latest')
  // Search remains possible while a previous search is pending via Enter.
  await page.getByRole('searchbox', { name: 'Search users', exact: true }).press('Enter')
  await eventually(() => reads.some(query => query.q === 'latest'), 'New search must reach the API')
  releaseSearch()
  await page.waitForTimeout(150)
  assert.equal(await page.getByRole('button', { name: 'View Stale Search Result', exact: true }).count(), 0, 'Late search must not replace newer results')
  await page.getByRole('combobox', { name: 'Role filter', exact: true }).selectOption('')
  await page.getByRole('searchbox', { name: 'Search users', exact: true }).fill('avery')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByRole('combobox', { name: 'Role filter', exact: true }).selectOption('user')
  await page.getByRole('combobox', { name: 'Status filter', exact: true }).selectOption('active')
  await page.getByRole('combobox', { name: 'Sort users', exact: true }).selectOption('name')
  await page.waitForFunction(() => document.querySelector('select[aria-label="Sort users"]')?.value === 'name')
  await page.waitForTimeout(100)
  assert.ok(reads.some(query => query.q === 'avery' && query.role === 'user' && query.status === 'active' && query.sort === 'name' && query.page === '1'), 'Filters must reach the API')
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await page.waitForTimeout(100)
  assert.ok(reads.some(query => query.page === '2'), 'Pagination must reach the API')
  await page.getByRole('button', { name: 'Create user', exact: true }).click()
  const create = dialog('Create user')
  await create.waitFor()
  for (let tab = 0; tab < 10; tab++) { await page.keyboard.press('Tab'); assert.ok(await create.evaluate(el => el.contains(document.activeElement)), 'Native dialog traps keyboard focus') }
  await fits('Create dialog')
  assert.equal(await create.getByRole('combobox', { name: 'Role', exact: true }).locator('option[value=owner]').count(), 0, 'Owner cannot grant owner rank')
  await page.keyboard.press('Escape')
  await create.waitFor({ state: 'hidden' })
  assert.ok(await page.getByRole('button', { name: 'Create user', exact: true }).evaluate(el => el === document.activeElement), 'Dialog restores focus')
  await page.getByRole('button', { name: 'Create user', exact: true }).click()
  await create.getByRole('textbox', { name: 'Email', exact: true }).fill('new@example.test')
  await create.getByLabel('Temporary password', { exact: true }).fill('TemporaryPass123!')
  await create.getByRole('textbox', { name: 'Username (optional)', exact: true }).fill('new-account')
  await create.getByRole('textbox', { name: 'Display name (optional)', exact: true }).fill('New Account')
  await create.getByRole('combobox', { name: 'Role', exact: true }).selectOption('support')
  holdWrite = 'create'
  await create.getByRole('button', { name: 'Create user', exact: true }).click()
  await page.waitForTimeout(100)
  await page.keyboard.press('Escape')
  assert.ok(await create.isVisible(), 'Pending dialog stays open')
  assert.ok(await create.getByRole('button', { name: 'Creating…', exact: true }).isDisabled(), 'Pending creation locked')
  assert.equal(writes.filter(write => write.path === '/admin/users').length, 1, 'Create only submitted once')
  assert.deepEqual(writes.at(-1).payload, { email: 'new@example.test', password: 'TemporaryPass123!', username: 'new-account', displayName: 'New Account', role: 'support', requirePasswordChange: true })
  holdWrite = null
  releaseWrite()
  await create.waitFor({ state: 'hidden' })
  holdDetail = true
  await page.getByRole('button', { name: 'View Owner Peer', exact: true }).click()
  await eventually(() => releaseDetail, 'Slow detail must be pending')
  await page.getByRole('row').filter({ hasText: 'Avery Creator' }).getByText('Avery Creator', { exact: true }).click()
  await page.getByRole('heading', { name: 'Avery Creator', exact: true }).waitFor()
  holdDetail = false
  releaseDetail()
  await page.waitForTimeout(150)
  assert.equal(await page.getByRole('heading', { name: 'Owner Peer', exact: true }).count(), 0, 'Late detail must not replace selected account')
  assert.equal(await page.locator('a[href="/u/account-avery"]').count(), 0, 'No invented public page slug')
  assert.ok(await page.getByRole('button', { name: 'Impersonate', exact: true }).isDisabled(), 'Missing backend action stays disabled')
  await fits('User detail')
  await page.getByRole('button', { name: 'Suspend', exact: true }).click()
  const suspend = dialog('Suspend user')
  await suspend.getByRole('textbox', { name: 'Reason', exact: true }).fill('Repeated harassment in fixture')
  await suspend.getByRole('spinbutton', { name: 'Duration (hours)', exact: true }).fill('48')
  assert.ok(await suspend.getByRole('button', { name: 'Confirm suspension', exact: true }).isDisabled(), 'Sensitive action requires confirmation')
  await suspend.getByRole('checkbox', { name: 'I confirm this action for Avery Creator', exact: true }).check()
  await suspend.getByRole('button', { name: 'Confirm suspension', exact: true }).click()
  await suspend.waitFor({ state: 'hidden' })
  assert.deepEqual(writes.find(write => write.path.endsWith('/creator/suspend')).payload, { reason: 'Repeated harassment in fixture', durationHours: 48, permanent: false })
  await page.getByRole('button', { name: 'Reactivate', exact: true }).waitFor()
  await page.getByRole('textbox', { name: 'Internal note', exact: true }).fill('Follow-up fixture note.')
  await page.getByRole('button', { name: 'Add note', exact: true }).click()
  await page.getByText('Follow-up fixture note.', { exact: true }).waitFor()
  await page.getByText('Chrome on desktop', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Edit user', exact: true }).click()
  const edit = dialog('Edit user')
  await edit.getByRole('textbox', { name: 'Display name', exact: true }).fill('Avery Updated')
  await edit.getByRole('button', { name: 'Save changes', exact: true }).click()
  await edit.waitFor({ state: 'hidden' })
  await page.getByRole('heading', { name: 'Avery Updated', exact: true }).waitFor()
  assert.equal(writes.find(write => write.method === 'PATCH').payload.displayName, 'Avery Updated')
  await page.getByRole('button', { name: 'Revoke all sessions', exact: true }).click()
  const revoke = dialog('Revoke all sessions')
  await revoke.getByRole('textbox', { name: 'Reason', exact: true }).fill('Fixture session security review')
  await revoke.getByRole('checkbox', { name: 'I confirm this action for Avery Updated', exact: true }).check()
  await revoke.getByRole('button', { name: 'Confirm revocation', exact: true }).click()
  await revoke.waitFor({ state: 'hidden' })
  await page.getByText('No active sessions.', { exact: true }).waitFor()
  assert.deepEqual(writes.find(write => write.path === '/admin/users/creator/sessions' && write.method === 'DELETE').payload, { reason: 'Fixture session security review' })
  for (const [button, title, submit] of [['Reactivate', 'Reactivate user', 'Confirm reactivation'], ['Warn', 'Warn user', 'Confirm warning'], ['Ban', 'Ban user', 'Confirm ban'], ['Reactivate', 'Reactivate user', 'Confirm reactivation']]) {
    await page.getByRole('button', { name: button, exact: true }).click()
    const action = dialog(title)
    await action.getByRole('textbox', { name: 'Reason', exact: true }).fill('Fixture account action')
    await action.getByRole('checkbox', { name: 'I confirm this action for Avery Updated', exact: true }).check()
    await action.getByRole('button', { name: submit, exact: true }).click()
    await action.waitFor({ state: 'hidden' })
  }
  await page.getByRole('button', { name: 'View Owner Peer', exact: true }).click()
  await page.getByRole('heading', { name: 'Owner Peer', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Ban', exact: true }).click()
  const ban = dialog('Ban user')
  await ban.getByRole('textbox', { name: 'Reason', exact: true }).fill('Fixture last owner check')
  await ban.getByRole('checkbox', { name: 'I confirm this action for Owner Peer', exact: true }).check()
  await ban.getByRole('button', { name: 'Confirm ban', exact: true }).click()
  await ban.getByText('This is the last active owner; promote another owner first.', { exact: true }).waitFor()
  assert.ok(await ban.isVisible(), 'Rejected action preserves dialog and reason')
  await ban.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'View Owner Self', exact: true }).click()
  await page.getByRole('heading', { name: 'Owner Self', exact: true }).waitFor()
  assert.ok(await page.getByRole('button', { name: 'Suspend', exact: true }).isDisabled(), 'Cannot moderate self')
  role = 'support'
  reads.length = 0
  const writesBeforeSupport = writes.length
  await page.reload()
  await page.getByRole('heading', { name: 'Users', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Create user', exact: true }).count(), 0, 'Support cannot create')
  await page.getByRole('button', { name: 'View Avery Updated', exact: true }).click()
  await page.getByRole('heading', { name: 'Avery Updated', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Suspend', exact: true }).count(), 0, 'Support cannot sanction')
  assert.equal(await page.getByRole('button', { name: 'Edit user', exact: true }).count(), 0, 'Support cannot edit')
  assert.equal(await page.getByRole('button', { name: 'Revoke all sessions', exact: true }).count(), 0, 'Support cannot revoke sessions')
  assert.equal(writes.length, writesBeforeSupport, 'Forbidden mutations are never requested')
  assert.deepEqual(errors, [])
  console.log('PASS admin users: server filters/pagination, stale list/detail reads, create payload and pending/focus lock, detail/edit/notes/sessions/revocation, confirmed moderation, last-owner rejection, self and support restrictions, disabled impersonation, mobile overflow')
} catch (error) {
  console.error('Browser diagnostics:', page.url(), await page.locator('body').innerText({ timeout: 2000 }).catch(() => 'No body'), errors)
  console.error('Overflow diagnostics:', await page.evaluate(() => Array.from(document.querySelectorAll('body *')).map(el => ({ tag: el.tagName, className: el.className?.toString(), width: Math.round(el.getBoundingClientRect().width), right: Math.round(el.getBoundingClientRect().right), overflow: getComputedStyle(el).overflowX })).filter(el => el.right > innerWidth && el.width > 0)).catch(() => []))
  console.error('Scroll origin:', await page.evaluate(() => ({ rootWidth: document.documentElement.scrollWidth, viewport: innerWidth, tableParent: document.querySelector('.admin-users-table')?.parentElement?.getBoundingClientRect().toJSON(), hiddenParent: document.querySelector('.admin-user-visually-hidden')?.offsetParent?.tagName })).catch(() => null))
  throw error
} finally { await browser.close() }
