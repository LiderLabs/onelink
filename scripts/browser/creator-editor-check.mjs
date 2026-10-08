import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const origin = process.env.BASE_URL ?? 'http://localhost:5173'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort())
page.setDefaultTimeout(12000); page.setDefaultNavigationTimeout(30000)
const errors = []
page.on('pageerror', cause => errors.push(cause.message))
async function api(path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(`/api/v1${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, payload: await response.json() }
  }, { path, method, body })
}
let owned, original
try {
  await page.goto(`${origin}/login`, { waitUntil: 'commit' })
  assert.equal((await api('/auth/login', 'POST', { identifier: process.env.CREATOR_TEST_ACCOUNT ?? 'setup1791462616506', password: 'CreatorJourney123!' })).status, 200)
  owned = (await api('/pages/mine?limit=100')).payload.data.find(item => item.accessRole === 'owner')
  original = (await api(`/pages/${owned.id}/draft`)).payload.data.draft
  await page.goto(`${origin}/app/pages/${owned.id}`, { waitUntil: 'commit' })
  if (process.env.EXPECT_RED) await page.getByRole('heading', { name: original.content.page.title || owned.slug, exact: true }).first().waitFor({ timeout: 30000 })
  await page.getByRole('heading', { name: 'Your page, your way.' }).waitFor({ timeout: process.env.EXPECT_RED ? 2000 : 12000 })
  const profile = page.getByRole('tab', { name: 'Profile', exact: true })
  assert.equal(await profile.getAttribute('aria-selected'), 'true')
  await page.locator('.creator-preview .page-renderer').waitFor()
  const title = `Browser page ${Date.now()}`
  await page.getByLabel('Page display name', { exact: true }).fill(title)
  await page.locator('.creator-preview').getByRole('heading', { name: title, exact: true }).waitFor()
  await page.getByLabel('Short bio', { exact: true }).fill('A private page introduction.')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await page.getByText('All changes saved', { exact: true }).first().waitFor()
  let draft = (await api(`/pages/${owned.id}/draft`)).payload.data.draft
  assert.equal(draft.content.page.title, title)
  assert.equal(draft.content.page.bio, 'A private page introduction.')
  assert.deepEqual(draft.content.links, original.content.links)
  assert.equal((await api(`/public/pages/${owned.slug}`)).status, 404)
  await page.getByRole('tab', { name: 'Links', exact: true }).click()
  await page.getByRole('heading', { name: 'Your links', exact: true }).waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Page design', exact: true }).isVisible(), false)
  await page.getByRole('tab', { name: 'Design', exact: true }).click()
  await page.getByLabel('Theme', { exact: true }).selectOption('dark')
  await page.getByLabel('Accent colour', { exact: true }).fill('#00d8ef')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await page.getByText('All changes saved', { exact: true }).first().waitFor()
  draft = (await api(`/pages/${owned.id}/draft`)).payload.data.draft
  assert.equal(draft.content.page.accentColor, '#00d8ef')
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await page.getByRole('heading', { name: 'Published versions', exact: true }).waitFor()
  assert.equal(await page.getByRole('tab', { name: 'Publishing', exact: true }).getAttribute('aria-selected'), 'true')
  await profile.click()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await page.evaluate(() => window.scrollTo(0, 500))
  assert.equal(Math.round((await page.locator('.creator-topbar').boundingBox()).y), 0)
  await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement?.blur() })
  await page.screenshot({ path: 'output/playwright/creator-editor-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: 'output/playwright/creator-editor-desktop.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('PASS page editor: tabs, immediate preview, real private draft saves, design, history, mobile and sticky header')
} finally {
  if (original && owned && !process.env.EXPECT_RED) {
    const current = (await api(`/pages/${owned.id}/draft`)).payload.data.draft
    assert.equal((await api(`/pages/${owned.id}/draft`, 'PUT', { content: original.content, updatedAt: current.updatedAt })).status, 200)
  }
  await browser.close()
}
