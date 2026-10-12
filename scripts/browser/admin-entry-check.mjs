import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const origin = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
page.setDefaultTimeout(20000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
let role = 'owner', signedIn = false, forced = false
let adminReads = 0
const now = Date.now()
const capabilities = ['users.read', 'users.create', 'users.update', 'users.sanction', 'users.delete', 'users.role.assign', 'reports.read', 'reports.resolve', 'appeals.read', 'appeals.decide', 'content.read', 'content.moderate', 'settings.read', 'settings.update', 'audit.read']
const user = () => ({ id: 'entry-owner', username: 'admin-owner', email: 'owner@example.test', displayName: 'Admin Owner', role, status: 'active', bio: null, location: null, pronouns: null, avatarKey: null, avatarUrl: null, statusReason: null, suspendedUntil: null, suspendedPermanently: false, emailVerified: true, requirePasswordChange: forced, lastLoginAt: now, loginCount: 2, createdAt: now, updatedAt: now, deletedAt: null, sessionId: 'entry-session', sessionExpiresAt: now + 3600000, impersonatedBy: null })
const caps = () => role === 'owner' ? capabilities : role === 'support' ? ['users.read', 'reports.read', 'content.read', 'appeals.read'] : []
await page.route('**/api/v1/**', async route => {
  const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
  const ok = data => route.fulfill({ json: { data } })
  const list = (items, total = items.length) => route.fulfill({ json: { data: items, meta: { page: 1, limit: 5, total, totalPages: Math.ceil(total / 5) || 1 } } })
  if (path === '/public/settings') return ok({ platformName: 'OneLink', settings: { 'platform.registration_open': true }, roles: [] })
  if (path === '/auth/login') { signedIn = true; return ok({ user: user(), capabilities: caps() }) }
  if (path === '/auth/logout') { signedIn = false; return ok({ loggedOut: true }) }
  if (path === '/auth/me') return signedIn ? ok({ user: user(), capabilities: caps(), platformName: 'OneLink', serverTime: now }) : route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED', message: 'Sign in required.' } } })
  if (path.startsWith('/admin/')) {
    adminReads++
    if (path === '/admin/users') return list([user()], 8)
    if (path === '/admin/reports') return list([], 0)
    if (path === '/admin/audit-logs') return list([], 0)
    return list([])
  }
  if (path === '/pages/mine') return list([])
  if (path === '/auth/socials') return ok({ socials: [] })
  if (path === '/auth/sessions') return ok({ sessions: [] })
  return ok({})
})
try {
  await page.goto(`${origin}/login`)
  await page.getByRole('textbox', { name: 'Email or username' }).fill('owner@example.test')
  await page.locator('input[name="password"]').fill('FixturePassword123!')
  await page.getByRole('button', { name: 'Sign In to OneLink' }).click()
  await page.waitForURL('**/admin')
  await page.getByRole('heading', { name: 'Admin Overview', exact: true }).waitFor()
  await page.getByRole('link', { name: 'Users', exact: true }).first().waitFor()
  await mkdir('output/playwright', { recursive: true })
  await page.screenshot({ path: 'output/playwright/admin-overview-1440.png', fullPage: true })
  await page.getByRole('button', { name: 'Hide sidebar' }).click()
  await page.getByRole('button', { name: 'Show sidebar' }).waitFor()
  await page.getByRole('button', { name: 'Show sidebar' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Admin must fit mobile width')
  await page.screenshot({ path: 'output/playwright/admin-overview-390.png', fullPage: true })
  await page.getByRole('button', { name: 'Open admin navigation' }).click()
  await page.getByRole('dialog', { name: 'Admin navigation' }).getByRole('link', { name: 'Users', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${origin}/app/dashboard`)
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('link', { name: 'Admin', exact: true }).click()
  await page.waitForURL('**/admin')
  // Wait for the preceding overview reads before measuring denied navigation.
  await page.getByRole('region', { name: 'Platform totals' }).waitFor()
  role = 'user'; const before = adminReads
  await page.goto(`${origin}/admin/users`)
  await page.waitForURL('**/app/dashboard')
  await page.getByText('You do not have permission to access the admin workspace.').waitFor()
  assert.equal(adminReads, before, 'Denied entry must not load admin data')
  await page.getByRole('button', { name: 'Account menu' }).click()
  assert.equal(await page.getByRole('link', { name: 'Admin', exact: true }).count(), 0)
  role = 'owner'; forced = true
  await page.goto(`${origin}/admin`)
  await page.waitForURL('**/app/settings/security')
  assert.equal(adminReads, before, 'Forced-password sessions must not load admin data')
  forced = false; role = 'support'
  await page.goto(`${origin}/admin`)
  await page.getByRole('heading', { name: 'Admin Overview', exact: true }).waitFor()
  assert.equal(await page.getByRole('link', { name: 'System Settings', exact: true }).count(), 0)
  assert.equal(await page.getByRole('link', { name: 'Audit Log', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Create user', exact: true }).count(), 0)
  await page.goto(`${origin}/admin/settings`)
  await page.getByRole('heading', { name: 'Permission required', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.waitForURL('**/login**')
  assert.deepEqual(errors, [])
  console.log('PASS admin entry, role guards, creator avatar entry, mobile navigation, and logout')
} catch (error) {
  console.error('Admin entry diagnostics:', page.url(), await page.locator('body').innerText().catch(() => 'No body'), errors)
  console.error('Sign-in geometry:', await page.locator('button.auth-submit').evaluateAll(elements => elements.map(e => ({ rect: e.getBoundingClientRect().toJSON(), display: getComputedStyle(e).display, visibility: getComputedStyle(e).visibility, disabled: e.disabled, animations: e.getAnimations().map(a => a.playState) }))))
  await page.screenshot({ path: 'output/playwright/admin-entry-error.png', fullPage: true })
  throw error
} finally { await browser.close() }
