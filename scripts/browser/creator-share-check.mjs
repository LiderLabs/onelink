import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import QRCode from 'qrcode'

// Read-only fixture. Published/review contracts are intercepted without writes.
const origin = process.env.BASE_URL ?? 'http://localhost:5173'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
page.setDefaultTimeout(12000)
page.setDefaultNavigationTimeout(30000)
await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort())
const errors = []
page.on('pageerror', error => errors.push(error.message))
let writes = 0
page.on('request', request => { if (request.url().includes('/api/v1/pages') && request.method() !== 'GET') writes++ })
async function api(path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(`/api/v1${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, payload: await response.json() }
  }, { path, method, body })
}
async function download(name) {
  const wait = page.waitForEvent('download')
  await page.getByRole('button', { name, exact: true }).click()
  return await readFile(await (await wait).path())
}
try {
  await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded' })
  assert.equal((await api('/auth/login', 'POST', { identifier: process.env.CREATOR_TEST_ACCOUNT ?? 'setup1791462616506', password: 'CreatorJourney123!' })).status, 200)
  const owned = (await api('/pages/mine?limit=100')).payload.data.find(item => item.accessRole === 'owner')
  assert.ok(owned, 'Existing account must own a page')
  const privatePreview = (await api(`/pages/${owned.id}/preview`)).payload.data.page
  assert.equal(owned.status, 'draft', 'Use the private fixture to prove draft gating')
  await page.goto(`${origin}/app/share?page=${owned.id}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Share your world.' }).waitFor({ timeout: process.env.EXPECT_RED ? 2000 : 12000 })
  const address = `${origin}/${encodeURIComponent(owned.slug)}`
  assert.equal(await page.getByLabel('Page address', { exact: true }).inputValue(), address)
  assert.equal(await page.getByRole('button', { name: 'Share page', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Download PNG', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Download SVG', exact: true }).isDisabled(), true)
  assert.match(await page.locator('#share-availability').innerText(), /publish/i)
  await page.getByRole('button', { name: 'Private preview', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Saved page preview' })
  await dialog.waitFor()
  await dialog.locator('.page-renderer').waitFor()
  assert.equal(await dialog.locator('.page-renderer h1').innerText(), privatePreview.title || privatePreview.owner.displayName)
  await dialog.getByRole('button', { name: 'Close preview', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })

  // Keep canonical URL derivation and gating real; intercept only API responses.
  const published = { ...owned, status: 'published', moderationStatus: 'visible' }
  await page.route('**/api/v1/pages/mine?*', route => route.fulfill({ json: { data: [published, { ...owned, id: 'share-contract-second', slug: 'profile', title: 'Second page', status: 'draft' }], meta: { page: 1, limit: 100, total: 2, totalPages: 1 } } }))
  await page.route(`**/api/v1/public/pages/${encodeURIComponent(owned.slug)}`, route => route.fulfill({ json: { data: { page: privatePreview } } }))
  await page.addInitScript(() => {
    window.__sharePayload = null
    Object.defineProperty(navigator, 'share', { configurable: true, value: async payload => { window.__sharePayload = payload } })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__copiedAddress = value } } })
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Share page"]')?.disabled)
  await page.getByRole('button', { name: 'Share page', exact: true }).click()
  assert.equal((await page.evaluate(() => window.__sharePayload)).url, address)
  await page.getByRole('button', { name: 'Copy address', exact: true }).click()
  assert.equal(await page.evaluate(() => window.__copiedAddress), address)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Clipboard blocked') } } })
  })
  await page.getByRole('button', { name: 'Share page', exact: true }).click()
  await page.getByRole('status').filter({ hasText: /address is selected/i }).waitFor()
  assert.equal(await page.getByLabel('Page address', { exact: true }).evaluate(input => input.selectionEnd - input.selectionStart), address.length, 'A blocked clipboard selects the actual address for manual copying')
  assert.equal(await page.getByRole('link', { name: 'Open page', exact: true }).getAttribute('href'), `/${encodeURIComponent(owned.slug)}`)
  for (const [name, host] of [['X', 'twitter.com'], ['WhatsApp', 'wa.me'], ['LinkedIn', 'www.linkedin.com'], ['Facebook', 'www.facebook.com']]) {
    const href = await page.getByRole('link', { name: `Share on ${name}`, exact: true }).getAttribute('href')
    const intent = new URL(href)
    assert.equal(intent.hostname, host)
    assert.ok([...intent.searchParams.values()].some(value => value.includes(address)))
  }
  await page.getByRole('checkbox', { name: 'Include OneLink badge', exact: true }).uncheck()
  const svg = (await download('Download SVG')).toString('utf8')
  const expectedSvg = await QRCode.toString(address, { type: 'svg', width: 1024, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#0c0e14', light: '#ffffff' } })
  assert.equal(svg, expectedSvg, 'SVG must encode the actual canonical URL with an opaque four-module quiet zone')
  let png = await download('Download PNG')
  assert.equal(png.readUInt32BE(16), 1024)
  assert.equal(png.readUInt32BE(20), 1024)
  await page.getByRole('slider', { name: 'QR resolution', exact: true }).fill('2048')
  await page.getByRole('checkbox', { name: 'Include OneLink badge', exact: true }).check()
  png = await download('Download PNG')
  assert.equal(png.readUInt32BE(16), 2048)
  assert.equal(png.readUInt32BE(20), 2294, 'Badge adds a separate 12% strip below the full quiet zone')
  await page.getByLabel('Custom pattern color', { exact: true }).fill('#ffffff')
  await page.getByRole('alert').filter({ hasText: /contrast/i }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Download PNG', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Download SVG', exact: true }).isDisabled(), true)
  await page.getByLabel('Custom pattern color', { exact: true }).fill('#0c0e14')
  await page.getByLabel('Page to share', { exact: true }).selectOption('share-contract-second')
  assert.equal(await page.getByLabel('Page address', { exact: true }).inputValue(), `${origin}/p/profile`, 'Reserved root slugs use the canonical /p route')
  assert.equal(await page.getByRole('button', { name: 'Share page', exact: true }).isDisabled(), true)
  await page.getByLabel('Page to share', { exact: true }).selectOption(owned.id)
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Share page"]')?.disabled)

  await mkdir('output/playwright', { recursive: true })
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0) })
  await page.screenshot({ path: 'output/playwright/creator-share-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Mobile view must fit the viewport')
  await page.evaluate(() => window.scrollTo(0, 500))
  assert.equal(Math.round((await page.locator('.creator-topbar').boundingBox()).y), 0)
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0) })
  await page.screenshot({ path: 'output/playwright/creator-share-mobile.png', fullPage: true })

  await page.unroute('**/api/v1/pages/mine?*')
  await page.route('**/api/v1/pages/mine?*', route => route.fulfill({ json: { data: [{ ...published, moderationStatus: 'under_review' }], meta: { page: 1, limit: 100, total: 1, totalPages: 1 } } }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText(/awaiting review/i).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Share page', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Download SVG', exact: true }).isDisabled(), true)
  await page.unroute('**/api/v1/pages/mine?*')
  await page.route('**/api/v1/pages/mine?*', route => route.fulfill({ json: { data: [published], meta: { page: 1, limit: 100, total: 1, totalPages: 1 } } }))
  await page.unroute(`**/api/v1/public/pages/${encodeURIComponent(owned.slug)}`)
  await page.route(`**/api/v1/public/pages/${encodeURIComponent(owned.slug)}`, route => route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Page unavailable.' } } }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText(/could not verify/i).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Share page', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Download SVG', exact: true }).isDisabled(), true)
  assert.equal(writes, 0, 'Sharing cannot publish or mutate the fixture')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: ['private preview', 'draft/review/public verification gating', 'canonical URLs and page picker', 'native share/copy/social URLs', 'exact SVG encoding', 'PNG dimensions and badge strip', 'contrast guard', '390px fit and sticky header'], writes, errors }))
} finally { await browser.close() }
