import assert from 'node:assert/strict'
import { chromium } from 'playwright'

// Use an unpublished test account after running creator-resilience-check.mjs.
const account = process.env.CREATOR_TEST_ACCOUNT
if (!account) throw new Error('Set CREATOR_TEST_ACCOUNT to a test creator at the final setup step.')
const origin = process.env.BASE_URL ?? 'http://localhost:5173'
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
page.setDefaultTimeout(15000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
async function api(path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(`/api/v1${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
    const raw = await response.text()
    return { status: response.status, payload: raw ? JSON.parse(raw) : null }
  }, { path, method, body })
}
try {
  await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded' })
  assert.equal((await api('/auth/login', 'POST', { identifier: account, password: 'CreatorJourney123!' })).status, 200)
  await page.goto(`${origin}/app`)
  await page.getByRole('heading', { name: 'You’re one click away.' }).waitFor()
  const owned = (await api('/pages/mine?limit=100')).payload.data[0]
  const saved = (await api(`/pages/${owned.id}/draft`)).payload.data.draft
  assert.equal((await api(`/pages/${owned.id}/draft`, 'PUT', { content: { ...saved.content, page: { ...saved.content.page, accentColor: '#ec4899' } }, updatedAt: saved.updatedAt })).status, 200)
  await page.getByRole('button', { name: 'Publish my page', exact: true }).click()
  await page.getByRole('alert').getByText(/Your draft changed in another tab/).waitFor()
  assert.equal((await api(`/public/pages/${owned.slug}`)).status, 404, 'A stale review must not publish a newer unseen draft')
  await page.getByRole('button', { name: 'Load latest saved version' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Load latest version', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  // Contract case: a publish response can remain under moderation review.
  await page.route('**/api/v1/pages/*/publish', async route => {
    const response = await route.fetch()
    const payload = await response.json()
    assert.equal(payload.data.status, 'published')
    payload.data.moderationStatus = 'under_review'
    await route.fulfill({ response, json: payload })
  })
  await page.getByRole('button', { name: 'Publish my page', exact: true }).click()
  await page.getByRole('heading', { name: 'Your page is awaiting review.' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Copy address', exact: true }).count(), 0)
  assert.equal(await page.getByRole('link', { name: 'Open my page', exact: true }).count(), 0)
  assert.equal(await page.getByRole('heading', { name: 'QR code for your page' }).count(), 0)
  await page.getByRole('link', { name: 'Go to dashboard' }).click()
  await page.waitForURL('**/app/dashboard')
  await page.locator('.creator-preview .page-renderer').waitFor()
  await page.getByRole('link', { name: 'Add Link', exact: true }).click()
  const linkDialog = page.getByRole('dialog', { name: 'Add a link', exact: true })
  await linkDialog.waitFor()
  await linkDialog.getByRole('button', { name: 'Close', exact: true }).click()
  await linkDialog.waitFor({ state: 'hidden' })
  await page.getByRole('link', { name: 'Share & QR', exact: true }).click()
  await page.getByRole('button', { name: 'Close QR tools', exact: true }).waitFor()
  await page.getByRole('link', { name: 'Profile & security', exact: true }).click()
  await page.getByRole('heading', { name: 'Security', exact: true }).waitFor()
  const latest = (await api(`/pages/${owned.id}/draft`)).payload.data.draft
  assert.equal((await api(`/pages/${owned.id}/draft`, 'PUT', { content: { ...latest.content, links: [] }, updatedAt: latest.updatedAt })).status, 200)
  await page.getByRole('link', { name: 'Overview', exact: true }).click()
  await page.getByRole('link', { name: 'Add your first link', exact: true }).click()
  await linkDialog.waitFor()
  await linkDialog.getByRole('button', { name: 'Close', exact: true }).click()
  assert.equal((await api(`/pages/${owned.id}/unpublish`, 'POST')).status, 200)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.goto(`${origin}/login?next=/app/onboarding`)
  await page.locator('input[name=identifier]').fill(account)
  await page.locator('input[name=password]').fill('CreatorJourney123!')
  await page.getByRole('button', { name: 'Sign In to OneLink' }).click()
  await page.waitForURL('**/app/dashboard')
  await page.getByRole('heading', { name: /Welcome back/ }).waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS creator navigation: publish preflight, moderated success state, Add Link, Share & QR, profile security, completed empty-draft CTA, unpublish history, sign-in destination')
} catch (error) {
  console.error('Browser diagnostics:', page.url(), await page.locator('body').innerText({ timeout: 2000 }).catch(() => 'No page body'), errors)
  throw error
} finally { await browser.close() }
