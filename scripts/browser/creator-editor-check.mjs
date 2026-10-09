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
  await page.locator('.creator-editor-save-state').filter({ hasText: 'All changes saved' }).waitFor()
  let draft = (await api(`/pages/${owned.id}/draft`)).payload.data.draft
  assert.equal(draft.content.page.title, title)
  assert.equal(draft.content.page.bio, 'A private page introduction.')
  assert.deepEqual(draft.content.links, original.content.links)
  assert.equal((await api(`/public/pages/${owned.slug}`)).status, 404)
  await page.getByRole('tab', { name: 'Links', exact: true }).click()
  await page.getByRole('heading', { name: 'Your links', exact: true }).waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Page design', exact: true }).isVisible(), false)
  const selection = page.getByRole('checkbox', { name: /^Select / }).first()
  await selection.check()
  await selection.uncheck()
  await page.getByRole('heading', { name: 'Your links', exact: true }).waitFor()
  assert.deepEqual(errors, [], 'Selecting a link must keep the editor working')
  await page.getByLabel('New group', { exact: true }).fill('Unsaved collection')
  await page.getByRole('link', { name: 'Overview', exact: true }).first().click()
  await page.getByRole('dialog', { name: 'Leave without saving?' }).waitFor({ timeout: 2500 })
  await page.getByRole('dialog', { name: 'Leave without saving?' }).getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('dialog', { name: 'Leave without saving?' }).waitFor({ state: 'hidden' })
  const groupInput = page.getByLabel('New group', { exact: true })
  await groupInput.fill('')
  await groupInput.blur()
  assert.equal(await groupInput.inputValue(), '')
  await page.getByRole('button', { name: 'Add a link', exact: true }).click()
  const linkDialog = page.getByRole('dialog', { name: 'Add Link', exact: true })
  await linkDialog.getByLabel('URL', { exact: true }).fill('https://example.com/editor-check')
  await linkDialog.getByLabel('Title', { exact: true }).fill('Schedule check')
  await linkDialog.getByLabel('Starts at (local time)', { exact: true }).fill('2030-01-01T12:00')
  await linkDialog.getByLabel('Ends at (local time)', { exact: true }).fill('2030-01-01T12:00')
  await linkDialog.getByRole('button', { name: 'Add link', exact: true }).click()
  await linkDialog.getByRole('alert').filter({ hasText: 'end time must be after' }).waitFor({ timeout: 2500 })
  await linkDialog.getByRole('button', { name: 'Close link editor', exact: true }).click()
  await page.getByRole('dialog', { name: 'Discard this link edit?' }).getByRole('button', { name: 'Discard changes', exact: true }).click()
  await linkDialog.waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('tab', { name: 'Profile', exact: true }).locator('svg').count(), 1)
  await page.getByRole('tab', { name: 'Design', exact: true }).click()
  await page.getByLabel('Theme', { exact: true }).selectOption('dark')
  await page.getByLabel('Accent colour', { exact: true }).fill('#00d8ef')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await page.locator('.creator-editor-save-state').filter({ hasText: 'All changes saved' }).waitFor()
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
} catch (cause) {
  console.error(JSON.stringify({ url: page.url(), saveState: await page.locator('.creator-editor-save-state').allTextContents(), groupInput: await page.getByLabel('New group', { exact: true }).inputValue().catch(() => null), alerts: await page.getByRole('alert').allTextContents(), openDialogs: await page.locator('dialog[open]').count() }))
  throw cause
} finally {
  if (original && owned && !process.env.EXPECT_RED) {
    const current = (await api(`/pages/${owned.id}/draft`)).payload.data.draft
    assert.equal((await api(`/pages/${owned.id}/draft`, 'PUT', { content: original.content, updatedAt: current.updatedAt })).status, 200)
  }
  await browser.close()
}
