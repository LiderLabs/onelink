import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const origin = process.env.BASE_URL ?? 'http://localhost:5173'
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
page.setDefaultTimeout(15000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
const account = process.env.CREATOR_TEST_ACCOUNT ?? `setup${Date.now()}`
const password = 'CreatorJourney123!'
async function api(path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(`/api/v1${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
    const raw = await response.text()
    return { status: response.status, payload: raw ? JSON.parse(raw) : null }
  }, { path, method, body })
}
async function fits(label) {
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label} must fit ${width}px`)
  }
  await page.setViewportSize({ width: 1280, height: 900 })
}
try {
  await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded' })
  if (process.env.CREATOR_TEST_ACCOUNT) {
    assert.equal((await api('/auth/login', 'POST', { identifier: account, password })).status, 200)
  } else {
    assert.equal((await api('/auth/register', 'POST', { username: account, displayName: 'Sam Creator', email: `${account}@example.test`, password })).status, 201)
  }
  await page.goto(`${origin}/app`)
  await page.getByRole('heading', { name: 'Claim your page address' }).waitFor()
  await fits('Claim')
  await page.getByRole('link', { name: 'Exit setup', exact: true }).click()
  await page.getByRole('heading', { name: /^Welcome, Sam/ }).waitFor()
  await page.getByRole('link', { name: 'Continue setup', exact: true }).first().click()
  await page.getByRole('textbox', { name: 'Page username', exact: true }).fill('login')
  await page.getByRole('button', { name: 'Claim & continue' }).click()
  await page.getByRole('alert').getByText('This address is reserved by OneLink.').waitFor()
  await page.getByRole('textbox', { name: 'Page username', exact: true }).fill(account)
  let refuseRead = true
  await page.route('**/api/v1/pages/*/draft', async route => {
    if (refuseRead && route.request().method() === 'GET') { refuseRead = false; await route.fulfill({ status: 503, json: { error: { code: 'INTERNAL', message: 'Draft read temporarily unavailable.' } } }) }
    else await route.continue()
  })
  await page.getByRole('button', { name: 'Claim & continue' }).click()
  await page.getByRole('button', { name: 'Load draft', exact: true }).click()
  await page.getByRole('heading', { name: 'Your profile', exact: true }).waitFor()
  assert.equal((await api('/pages/mine?limit=100')).payload.data.length, 1, 'Retry must not create a duplicate page')
  await fits('Profile')
  // Dirty identity must be protected when leaving setup.
  await page.getByRole('textbox', { name: /^Bio/ }).fill('A bio worth keeping.')
  await page.getByRole('link', { name: 'Exit setup', exact: true }).click()
  await page.getByRole('dialog', { name: 'Leave without saving?' }).getByRole('button', { name: 'Keep editing' }).click()
  assert.equal(await page.getByRole('textbox', { name: /^Bio/ }).inputValue(), 'A bio worth keeping.')
  await page.getByLabel('Choose profile photo', { exact: true }).setInputFiles('scripts/browser/fixtures/source-photo.png')
  const crop = page.getByRole('dialog', { name: 'Crop your photo' })
  await crop.waitFor()
  assert.equal(await page.locator('.creator-preview-photo').count(), 1)
  await crop.getByRole('slider', { name: 'Zoom' }).fill('1.5')
  await crop.getByRole('button', { name: 'Save photo', exact: true }).click()
  await crop.waitFor({ state: 'hidden' })
  await page.locator('.creator-preview .page-renderer header img').waitFor()
  assert.equal(await page.getByRole('textbox', { name: /^Bio/ }).inputValue(), 'A bio worth keeping.')
  // Social changes use their existing API and appear immediately in the preview.
  await page.getByRole('combobox', { name: 'Platform', exact: true }).selectOption('instagram')
  await page.getByRole('textbox', { name: 'URL', exact: true }).fill('https://instagram.com/samcreator')
  await page.getByRole('button', { name: 'Save & continue', exact: true }).click()
  await page.getByRole('alert').getByText(/Save or cancel your social profile edits/).waitFor()
  await page.getByRole('button', { name: 'Add link', exact: true }).click()
  await page.getByRole('textbox', { name: 'URL', exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('.profile-social-add input[type=url]')?.value === '')
  await page.getByRole('button', { name: 'Save & continue', exact: true }).click()
  await page.getByRole('heading', { name: 'Add your first links' }).waitFor()
  await fits('Links')
  for (const [title, url] of [['Portfolio', 'https://example.com'], ['My store', 'https://example.org']]) {
    await page.getByRole('button', { name: 'Add Link', exact: true }).click()
    await page.getByRole('textbox', { name: 'Destination URL', exact: true }).fill(url)
    await page.getByRole('textbox', { name: 'Button title', exact: true }).fill(title)
    await page.getByRole('dialog').getByRole('button', { name: 'Add link', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
  }
  await page.getByRole('button', { name: 'Move My store up', exact: true }).click()
  await page.getByRole('button', { name: 'Hide Portfolio', exact: true }).click()
  await page.getByRole('button', { name: 'Show Portfolio', exact: true }).waitFor()
  const owned = (await api('/pages/mine?limit=100')).payload.data[0]
  const saved = (await api(`/pages/${owned.id}/draft`)).payload.data.draft
  assert.equal(saved.content.links[0].title, 'My store')
  assert.equal(saved.content.links[1].isVisible, false)
  await api('/auth/logout', 'POST')
  await page.goto(`${origin}/login`)
  await page.locator('input[name=identifier]').fill(account)
  await page.locator('input[name=password]').fill(password)
  await page.getByRole('button', { name: 'Sign In to OneLink' }).click()
  await page.waitForURL('**/app/onboarding')
  await page.getByRole('heading', { name: 'Add your first links' }).waitFor()
  await page.getByRole('button', { name: 'Save & continue', exact: true }).click()
  await page.getByRole('heading', { name: 'Customize your design' }).waitFor()
  await fits('Design')
  await page.getByRole('button', { name: 'Minimal', exact: true }).click()
  // A stale tab must not overwrite another saved draft.
  await api(`/pages/${owned.id}/draft`, 'PUT', { content: { ...saved.content, page: { ...saved.content.page, title: 'Changed in another tab' } }, updatedAt: saved.updatedAt })
  await page.getByRole('button', { name: 'Save & continue', exact: true }).click()
  await page.getByRole('button', { name: 'Load latest saved version' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Load latest version', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('textbox', { name: /^Page title/ }).inputValue(), 'Changed in another tab')
  await page.getByRole('button', { name: 'Save & continue', exact: true }).click()
  await page.getByRole('heading', { name: 'You’re one click away.' }).waitFor()
  await fits('Publish')
  const publicBefore = await api(`/public/pages/${owned.slug}`)
  assert.equal(publicBefore.status, 404)
  assert.deepEqual(errors, [])
  console.log('PASS creator resilience: new dashboard, mobile setup, reserved slug, claim/read recovery, dirty guard, crop/upload preview, social save, link order/visibility, incomplete sign-in, draft conflict recovery, private preview')
} catch (error) {
  console.error('Browser diagnostics:', page.url(), await page.locator('body').innerText({ timeout: 2000 }).catch(() => 'No page body'), errors)
  throw error
} finally { await browser.close() }
