import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

// Read-only fixture use: no registration, draft edits, or publication changes.
const account = process.env.CREATOR_TEST_ACCOUNT ?? 'setup1791462616506'
const origin = process.env.BASE_URL ?? 'http://localhost:5173'
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
page.setDefaultTimeout(12000)
page.setDefaultNavigationTimeout(30000)
await page.route(/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.abort())
const errors = []
page.on('pageerror', error => errors.push(error.message))

try {
  await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded' })
  const login = await page.evaluate(async ({ account }) => {
    const response = await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: account, password: 'CreatorJourney123!' }) })
    return response.status
  }, { account })
  assert.equal(login, 200, 'Existing fixture account must sign in')
  await page.goto(`${origin}/app/analytics`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Understand your audience.' }).waitFor({ timeout: 30000 })

  // Removing the unavailable-data branch must fail: unknown counts cannot become zero.
  assert.equal(await page.getByRole('button', { name: 'Your data', exact: true }).getAttribute('aria-pressed'), 'true')
  const metrics = page.getByRole('region', { name: 'Analytics metrics' })
  assert.equal(await metrics.getByText('—', { exact: true }).count(), 4)
  await page.getByText(/Visitor tracking is not available/).waitFor()
  const exportButton = page.getByRole('button', { name: 'Export CSV', exact: true })
  assert.equal(await exportButton.isDisabled(), true)
  assert.match(await page.locator('#analytics-export-reason').innerText(), /tracking is unavailable/i)

  // Removing the opt-in switch or leaving the range static must fail.
  await page.getByRole('button', { name: 'Sample data', exact: true }).click()
  await metrics.getByText('744', { exact: true }).waitFor()
  await metrics.getByText('234', { exact: true }).waitFor()
  await metrics.getByText('31.5%', { exact: true }).waitFor()
  await metrics.getByText('567', { exact: true }).waitFor()
  await page.getByText(/Fictional sample data for illustration/).waitFor()
  assert.equal(await exportButton.isEnabled(), true)
  const chartPoint = page.getByRole('button', { name: /Inspect sample day/ }).first()
  await chartPoint.focus()
  const detail = page.getByRole('status', { name: 'Daily sample detail' })
  await detail.waitFor()
  assert.match(await detail.innerText(), /views[\s\S]*clicks/i)
  await page.getByRole('button', { name: '7 days', exact: true }).click()
  assert.notEqual(await metrics.getByRole('group', { name: 'Page views', exact: true }).locator('.creator-metric-value').innerText(), '744')
  assert.equal(await page.getByRole('button', { name: /Inspect sample day/ }).count(), 7)
  await page.getByRole('button', { name: '90 days', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: /Inspect sample day/ }).count(), 90)

  // Reversed dates must never apply or silently yield a misleading dataset.
  await page.getByRole('button', { name: 'Custom', exact: true }).click()
  await page.getByLabel('Start date').fill('2026-10-08')
  await page.getByLabel('End date').fill('2026-10-01')
  await page.getByRole('button', { name: 'Apply range', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: /Start date must be on or before/ }).waitFor()
  await page.getByLabel('Start date').fill('2026-10-01')
  await page.getByLabel('End date').fill('2026-10-03')
  await page.getByRole('button', { name: 'Apply range', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: /Inspect sample day/ }).count(), 3)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'Short custom chart must fit the mobile viewport')
  await page.setViewportSize({ width: 1440, height: 1000 })
  const downloadWait = page.waitForEvent('download')
  await exportButton.click()
  const download = await downloadWait
  assert.match(download.suggestedFilename(), /sample/)
  const csv = await readFile(await download.path(), 'utf8')
  assert.match(csv, /Fictional sample data/)
  assert.match(csv, /2026-10-01/)
  assert.match(csv, /2026-10-03/)
  const csvDays = csv.trim().split('\r\n').slice(1).map(row => row.split(','))
  assert.equal(csvDays.length, 3)
  assert.equal(csvDays.reduce((sum, row) => sum + Number(row[2]), 0), 74)
  assert.equal(csvDays.reduce((sum, row) => sum + Number(row[3]), 0), 23)

  await page.getByRole('button', { name: '30 days', exact: true }).click()
  await page.getByRole('button', { name: 'Inspect My Portfolio sample performance' }).click()
  const dialog = page.getByRole('dialog', { name: 'My Portfolio — sample performance' })
  await dialog.waitFor()
  await dialog.getByRole('button', { name: 'Close sample performance' }).click()
  await dialog.waitFor({ state: 'hidden' })
  await mkdir('output/playwright', { recursive: true })
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0) })
  await page.screenshot({ path: 'output/playwright/creator-analytics-sample-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'Mobile page must fit viewport')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: 'output/playwright/creator-analytics-sample-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Your data', exact: true }).click()
  assert.equal(await metrics.getByText('—', { exact: true }).count(), 4)
  assert.equal(await exportButton.isDisabled(), true)
  assert.deepEqual(errors, [])
  console.log('PASS creator analytics: unavailable default, sample opt-in, daily chart inspection, 7/30/90/custom ranges, date validation, labeled CSV, sample link dialog, mobile width')
} catch (error) {
  console.error('Layout diagnostics:', await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth, tableContainer: (() => { const element = document.querySelector('.analytics-table-scroll'); return element ? { width: element.getBoundingClientRect().width, scroll: element.scrollWidth, overflow: getComputedStyle(element).overflow, position: getComputedStyle(element).position } : null })(), overflowing: [...document.querySelectorAll('body *')].map(element => ({ tag: element.tagName, class: element.getAttribute('class'), right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width })).filter(element => element.right > innerWidth + 1).slice(0, 18) })).catch(() => null))
  console.error('Analytics diagnostics:', page.url(), await page.locator('body').innerText({ timeout: 2000 }).catch(() => 'No page body'), errors)
  throw error
} finally {
  await browser.close()
}
