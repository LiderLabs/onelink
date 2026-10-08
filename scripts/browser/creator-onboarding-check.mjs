import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

// Covers the real API-backed journey. Run against a disposable local database.
const origin = process.env.BASE_URL ?? 'http://localhost:5173'
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.setDefaultTimeout(15000)
const account = `creator${Date.now()}`
const password = 'CreatorJourney123!'
const errors = []
await mkdir('output/playwright/creator', { recursive: true })
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(`${origin}/register`, { waitUntil: 'domcontentloaded' })
  await page.locator('input[name="username"]').fill(account)
  await page.locator('input[name="displayName"]').fill('Taylor Kim')
  await page.locator('input[name="email"]').fill(`${account}@example.test`)
  await page.locator('input[name="password"]').fill(password)
  await page.locator('input[name="confirmPassword"]').fill(password)
  await page.getByRole('button', { name: 'Create Account', exact: true }).click()
  await page.getByRole('heading', { name: 'Claim your page address' }).waitFor()
  await page.getByRole('button', { name: 'Claim & continue' }).click()
  await page.getByRole('heading', { name: "Let’s make it yours" }).waitFor()
  await page.getByRole('textbox', { name: /^Bio/ }).fill('Building things for curious people.')
  await page.locator('.creator-preview .page-renderer').getByText('Building things for curious people.', { exact: true }).waitFor()
  await page.screenshot({ path: 'output/playwright/creator/profile-desktop.png', fullPage: true, timeout: 30000 })
  await page.getByRole('button', { name: 'Save & continue', exact: true }).click()
  await page.getByRole('heading', { name: 'Add your first links' }).waitFor()
  await page.getByRole('button', { name: 'Add Link', exact: true }).click()
  await page.getByRole('textbox', { name: 'Destination URL', exact: true }).fill('https://example.com/portfolio')
  await page.getByRole('textbox', { name: 'Button title', exact: true }).fill('My portfolio')
  await page.getByRole('dialog').getByRole('button', { name: 'Add link', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  // A reload must keep the saved private link and resume the current step.
  await page.reload()
  await page.getByRole('heading', { name: 'Add your first links' }).waitFor()
  await page.getByRole('heading', { name: 'My portfolio', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Save & continue', exact: true }).click()
  await page.getByRole('heading', { name: 'Customize your design' }).waitFor()
  await page.getByRole('button', { name: 'Minimal', exact: true }).click()
  await page.screenshot({ path: 'output/playwright/creator/design-desktop.png', fullPage: true, timeout: 30000 })
  await page.getByRole('button', { name: 'Save & continue', exact: true }).click()
  await page.getByRole('heading', { name: 'You’re one click away.' }).waitFor()
  const before = await page.evaluate(async () => (await (await fetch('/api/v1/pages/mine?limit=100')).json()).data)
  assert.equal(before[0].status, 'draft')
  const publicBefore = await page.evaluate(async slug => (await fetch(`/api/v1/public/pages/${slug}`)).status, before[0].slug)
  assert.equal(publicBefore, 404, 'A saved draft must stay private')
  await page.getByRole('button', { name: 'Publish my page', exact: true }).click()
  await page.getByRole('heading', { name: 'Looking good. You’re ready to share.' }).waitFor()
  await page.getByRole('link', { name: 'Go to dashboard', exact: true }).click()
  await page.getByRole('heading', { name: /Welcome back/ }).waitFor()
  await page.locator('.creator-preview .page-renderer').waitFor()
  await page.screenshot({ path: 'output/playwright/creator/dashboard-desktop.png', fullPage: true, timeout: 30000 })
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Dashboard must fit ${width}px`)
  }
  await page.screenshot({ path: 'output/playwright/creator/dashboard-mobile.png', fullPage: true, timeout: 30000 })
  const after = await page.evaluate(async () => (await (await fetch('/api/v1/pages/mine?limit=100')).json()).data)
  assert.equal(after[0].status, 'published')
  const publicPage = await page.evaluate(async slug => (await (await fetch(`/api/v1/public/pages/${slug}`)).json()).data.page, after[0].slug)
  assert.equal(publicPage.links[0].title, 'My portfolio')
  assert.equal(publicPage.theme, 'light')
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.goto(`${origin}/login`)
  await page.locator('input[name="identifier"]').fill(account)
  await page.locator('input[name="password"]').fill(password)
  await page.getByRole('button', { name: 'Sign In to OneLink', exact: true }).click()
  await page.waitForURL('**/app/dashboard')
  await page.getByRole('heading', { name: /Welcome back/ }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/app/dashboard')
  assert.deepEqual(errors, [])
  console.log('PASS creator onboarding: signup, claim, profile, links, persisted draft, design, real publish, dashboard, returning sign-in')
} catch (error) {
  console.error('Browser diagnostics:', page.url(), await page.locator('body').innerText({ timeout: 2000 }).catch(() => 'No page body'), errors)
  throw error
} finally {
  await browser.close()
}
