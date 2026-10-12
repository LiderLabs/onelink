import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'

const origin = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
page.setDefaultTimeout(9000)
page.setDefaultNavigationTimeout(30000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
const now = Date.now()
let role = 'owner'
const settings = [
  ['platform.name', 'OneLink', 'string', 'Platform name', 'platform'],
  ['platform.registration_open', true, 'boolean', 'Registration open', 'platform'],
  ['content.max_links_per_page', 50, 'number', 'Max links per page', 'content'],
  ['content.reserved_slugs', ['admin', 'api'], 'json', 'Reserved slugs', 'content'],
  ['audit.export_max_rows', 1000, 'number', 'Audit export cap', 'audit'],
].map(([key, value, type, label, group]) => ({ key, value, type, label, group, description: `Policy for ${label}.`, isPublic: false, updatedAt: now }))
const entries = Array.from({ length: 135 }, (_, index) => ({
  id: `audit-${String(135 - index).padStart(4, '0')}`, action: 'settings.update',
  actor_label: index === 0 ? '=DANGEROUS()' : 'Owner', actor_user_id: 'owner-fixture', actor_role: 'owner',
  target_type: 'settings', target_id: 'platform.name', target_label: 'Platform name', status: 'success',
  created_at: now - index * 1000, before: { name: 'OneLink' }, after: { name: 'Updated' },
  metadata: { test: true }, request_id: `request-${index}`, ip: '127.0.0.1', user_agent: 'Fixture Chrome', impersonated_by: null,
}))
const patches = []
const auditCalls = []
let concurrentWrites = 0
let maxConcurrentWrites = 0
let failPatch = false
let slowPatch = false
let failExportPage = false
let driftExport = false
let exportCap = 1000
let settingsReads = 0
let auditReads = 0

await page.route('**/api/v1/**', async route => {
  const request = route.request()
  const url = new URL(request.url())
  const path = url.pathname.replace('/api/v1', '')
  const send = (data, meta) => route.fulfill({ json: { data, ...(meta ? { meta } : {}) } })
  if (path === '/auth/me') return send({ user: {
    id: 'owner-fixture', username: 'owner', email: 'owner@example.test', displayName: 'Owner', role, status: 'active',
    avatarUrl: null, avatarKey: null, requirePasswordChange: false, impersonatedBy: null,
    sessionId: 'fixture-session', sessionExpiresAt: now + 9999999, createdAt: now, updatedAt: now,
  }, capabilities: role === 'owner' ? ['admin.access', 'settings.read', 'settings.update', 'audit.read', 'users.read', 'reports.read', 'appeals.read'] : role === 'admin' ? ['admin.access', 'settings.read', 'audit.read', 'users.read', 'reports.read', 'appeals.read'] : ['admin.access', 'reports.read'], platformName: 'OneLink', serverTime: now })
  if (path === '/public/settings') return send({ platformName: 'OneLink', settings: { 'platform.name': 'OneLink' } })
  if (path === '/admin/settings' && request.method() === 'GET') {
    settingsReads++
    return send(settings.map(record => record.key === 'audit.export_max_rows' ? { ...record, value: exportCap } : record), { page: 1, limit: 2, total: settings.length, totalPages: 3 })
  }
  if (path === '/admin/settings' && request.method() === 'PATCH') {
    patches.push(request.postDataJSON().settings)
    concurrentWrites++
    maxConcurrentWrites = Math.max(maxConcurrentWrites, concurrentWrites)
    if (slowPatch) await new Promise(resolve => setTimeout(resolve, 1000))
    concurrentWrites--
    if (failPatch) return route.fulfill({ status: 500, json: { error: { code: 'INTERNAL', message: 'Fixture settings save failed.' } } })
    const updated = request.postDataJSON().settings.map(patch => {
      const record = settings.find(setting => setting.key === patch.key)
      assert.ok(record, 'Only existing setting keys may be patched')
      record.value = patch.value
      record.updatedAt = Date.now()
      return { ...record }
    })
    return send({ settings: updated, changed: updated.map(record => record.key) })
  }
  if (path === '/admin/audit-logs/actions') return send({ actions: ['settings.update', 'user.ban'] })
  if (path === '/admin/audit-logs') {
    auditReads++
    auditCalls.push(Object.fromEntries(url.searchParams))
    const pageNumber = Number(url.searchParams.get('page') ?? 1)
    const limit = Number(url.searchParams.get('limit') ?? 25)
    if (limit === 100 && pageNumber === 2 && failExportPage) return route.fulfill({ status: 500, json: { error: { code: 'INTERNAL', message: 'Fixture export page failed.' } } })
    let filtered = entries.filter(entry => (!url.searchParams.get('action') || entry.action === url.searchParams.get('action')) && (!url.searchParams.get('status') || entry.status === url.searchParams.get('status')) && (!url.searchParams.get('q') || entry.actor_label.toLowerCase().includes(url.searchParams.get('q').toLowerCase())))
    const start = (pageNumber - 1) * limit
    let data = filtered.slice(start, start + limit)
    if (driftExport && limit === 100 && pageNumber === 2) data = [filtered[0], ...data.slice(1)]
    return send(data, { page: pageNumber, limit, total: filtered.length, totalPages: Math.ceil(filtered.length / limit) })
  }
  if (path.startsWith('/admin/audit-logs/')) return send(entries.find(entry => entry.id === path.split('/').at(-1)))
  return send([])
})

try {
  await page.goto(`${origin}/admin/settings`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Platform settings', exact: true }).waitFor()
  const name = page.getByLabel('Platform name', { exact: true })
  const numeric = page.getByLabel('Max links per page', { exact: true })
  const json = page.getByLabel('Reserved slugs', { exact: true })
  assert.equal(await name.inputValue(), 'OneLink')
  assert.ok(settingsReads <= 2, 'Settings returns all rows; only React StrictMode may repeat the initial read')
  assert.equal(await page.getByRole('button', { name: 'Edit email templates', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Edit rate limits', exact: true }).isDisabled(), true)
  await page.getByRole('checkbox', { name: 'Registration open', exact: true }).uncheck()
  await page.getByText('All changes saved', { exact: true }).waitFor()
  assert.equal(settings.find(record => record.key === 'platform.registration_open').value, false)

  slowPatch = true
  await name.fill('First edit')
  await page.getByText('Saving changes…', { exact: true }).waitFor()
  await name.fill('New edit while saving')
  assert.equal(await name.inputValue(), 'New edit while saving')
  await page.getByText('All changes saved', { exact: true }).waitFor()
  assert.equal(settings[0].value, 'New edit while saving')
  assert.equal(maxConcurrentWrites, 1, 'Autosave writes must be serialized')
  slowPatch = false

  const countBeforeInvalid = patches.length
  await json.fill('{broken')
  await page.getByText('Enter valid JSON.', { exact: true }).waitFor()
  await numeric.fill('')
  await page.getByText('Enter a finite number.', { exact: true }).waitFor()
  await page.waitForTimeout(900)
  assert.equal(patches.length, countBeforeInvalid)
  const overviewLink = page.getByRole('link', { name: 'Overview', exact: true })
  await overviewLink.click()
  const unsaved = page.getByRole('dialog', { name: 'Leave with unsaved changes?' })
  await unsaved.waitFor()
  await unsaved.getByRole('button', { name: 'Stay here', exact: true }).click()
  assert.equal(new URL(page.url()).pathname, '/admin/settings')
  await json.fill('["admin","api"]')
  await numeric.fill('50')

  failPatch = true
  await name.fill('Retry me')
  await page.getByText('Fixture settings save failed.', { exact: true }).waitFor()
  await name.fill('Retained after failure')
  await page.waitForTimeout(900)
  assert.equal(await name.inputValue(), 'Retained after failure')
  failPatch = false
  await page.getByRole('button', { name: 'Retry save', exact: true }).click()
  await page.getByText('All changes saved', { exact: true }).waitFor()
  assert.equal(settings[0].value, 'Retained after failure')

  await page.goto(`${origin}/admin/audit?entry=${entries[0].id}`)
  await page.getByRole('heading', { name: 'Audit log', exact: true }).waitFor()
  const detail = page.getByRole('dialog', { name: 'Audit entry' })
  await detail.waitFor()
  await detail.getByText('request-0', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await detail.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: /^Inspect audit-/ }).first().click()
  await detail.waitFor()
  await detail.getByRole('button', { name: 'Close entry', exact: true }).click()
  await detail.waitFor({ state: 'hidden' })
  await page.getByLabel('Action', { exact: true }).selectOption('settings.update')
  await page.getByLabel('Status', { exact: true }).selectOption('success')
  await page.getByLabel('Search audit log', { exact: true }).fill('owner')
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('table')?.textContent?.includes('Owner'))
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
  const download = await downloadPromise
  const csv = await readFile(await download.path(), 'utf8')
  assert.equal(csv.trim().split(/\r?\n/).length, 135, 'All 134 filtered records beyond page 1 are exported')
  const exportCalls = auditCalls.filter(call => call.limit === '100')
  assert.deepEqual(exportCalls.map(call => call.page), ['1', '2'])
  assert.ok(exportCalls.every(call => call.action === 'settings.update' && call.status === 'success' && call.q === 'owner'))
  assert.equal(exportCalls[0].to, exportCalls[1].to, 'Export freezes its upper date bound')
  await page.getByLabel('Search audit log', { exact: true }).fill('')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  const allDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
  const allCsv = await readFile(await (await allDownload).path(), 'utf8')
  assert.ok(allCsv.includes("'=DANGEROUS()"), 'Spreadsheet formulas must be escaped')
  failExportPage = true
  let unexpectedDownload = false
  const downloadListener = () => { unexpectedDownload = true }
  page.on('download', downloadListener)
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
  await page.getByText(/Fixture export page failed/).waitFor()
  assert.equal(unexpectedDownload, false, 'A failed export never downloads a partial CSV')
  failExportPage = false
  driftExport = true
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
  await page.getByText(/changed during export/).waitFor()
  assert.equal(unexpectedDownload, false, 'Pagination drift never downloads a partial CSV')
  page.off('download', downloadListener)
  driftExport = false
  exportCap = 100
  await page.reload()
  await page.getByRole('heading', { name: 'Audit log', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
  await page.getByText(/exceed.*100.*Narrow/i).waitFor()

  for (const route of ['settings', 'audit']) {
    await page.goto(`${origin}/admin/${route}`)
    await page.getByRole('heading', { name: route === 'settings' ? 'Platform settings' : 'Audit log', exact: true }).waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${route} fits a mobile viewport`)
  }
  role = 'admin'
  await page.goto(`${origin}/admin/settings`)
  await page.getByLabel('Platform name', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Platform name', { exact: true }).isDisabled(), true)
  await page.getByText(/Only an owner can change/i).waitFor()
  const readsBeforeModerator = [settingsReads, auditReads]
  role = 'moderator'
  await page.goto(`${origin}/admin/settings`)
  await page.waitForTimeout(500)
  await page.goto(`${origin}/admin/audit`)
  await page.waitForTimeout(500)
  assert.deepEqual([settingsReads, auditReads], readsBeforeModerator, 'Capabilities prevent unauthorized reads')
  assert.deepEqual(errors, [])
  console.log('PASS admin settings/audit: typed inputs, serial autosave, pending edits, validation, navigation guard, retry, owner/admin capabilities, unavailable editors, filter CSV pagination/cap/drift/failure/formula escaping, mobile fit, keyboard dialog')
} catch (error) {
  console.error('Admin settings/audit diagnostics:', page.url(), await page.locator('body').innerText({ timeout: 2000 }).catch(() => 'No body'), errors)
  throw error
} finally { await browser.close() }
