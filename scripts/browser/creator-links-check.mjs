import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const account = process.env.CREATOR_TEST_ACCOUNT ?? 'setup1791462616506'
const origin = process.env.BASE_URL ?? 'http://localhost:5173'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/New_York', reducedMotion: 'reduce' })
await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort())
page.setDefaultTimeout(12000)
page.setDefaultNavigationTimeout(30000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
async function api(path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(`/api/v1${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, payload: await response.json() }
  }, { path, method, body })
}
let saved, owned
try {
  await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded' })
  assert.equal((await api('/auth/login', 'POST', { identifier: account, password: 'CreatorJourney123!' })).status, 200)
  owned = (await api('/pages/mine?limit=100')).payload.data.find(item => item.accessRole === 'owner')
  assert.ok(owned, 'Fixture needs an owned page')
  saved = (await api(`/pages/${owned.id}/draft`)).payload.data.draft
  await page.goto(`${origin}/app/links?page=${owned.id}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Manage your links.' }).waitFor({ timeout: process.env.EXPECT_RED ? 2000 : 12000 })
  const stamp = Date.now()
  const title = `Browser portfolio ${stamp}`
  const group = `Browser group ${stamp}`
  await page.getByRole('button', { name: 'New group', exact: true }).click()
  await page.getByLabel('Group name').fill(group)
  await page.getByRole('dialog').getByRole('button', { name: 'Create group', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Add new link', exact: true }).click()
  await page.getByLabel('Destination URL').fill('https://example.com/browser-portfolio')
  await page.getByLabel('Button title').fill(title)
  await page.getByLabel('Group', { exact: true }).selectOption({ label: group })
  await page.getByRole('dialog').getByRole('button', { name: 'Add link', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  const row = page.locator('.link-manager-row').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
  const previewLink = page.locator('.creator-preview a[href="https://example.com/browser-portfolio"]')
  await row.waitFor()
  await previewLink.waitFor()
  let current = (await api(`/pages/${owned.id}/draft`)).payload.data.draft
  let created = current.content.links.find(link => link.title === title)
  assert.equal(current.content.groups.find(item => item.id === created.groupId).name, group)
  assert.deepEqual(current.content.page, saved.content.page, 'Link edits preserve the page design')
  assert.equal((await api(`/public/pages/${owned.slug}`)).status, 404, 'Draft saves do not publish')
  await row.getByRole('button', { name: `Hide ${title}`, exact: true }).click()
  await row.getByText('Hidden', { exact: true }).waitFor()
  assert.equal(await previewLink.count(), 0)
  await row.getByRole('button', { name: `Show ${title}`, exact: true }).click()
  await previewLink.waitFor()
  const secondTitle = `Browser second ${stamp}`
  current = (await api(`/pages/${owned.id}/draft`)).payload.data.draft
  const template = { description: null, icon: null, groupId: null, openInNewTab: true, thumbnailKey: null, startsAt: null, endsAt: null }
  assert.equal((await api(`/pages/${owned.id}/draft`, 'PUT', { updatedAt: current.updatedAt, content: { ...current.content, links: [...current.content.links, { ...template, title: `Browser hidden ${stamp}`, url: 'https://example.com/hidden', isVisible: false }, { ...template, title: secondTitle, url: 'https://example.com/second', isVisible: true }] } })).status, 200)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await row.waitFor()
  const ordered = page.waitForResponse(response => response.url().endsWith(`/pages/${owned.id}/draft`) && response.request().method() === 'PUT')
  await row.getByRole('button', { name: `Move ${title} down`, exact: true }).click()
  assert.equal((await ordered).status(), 200)
  current = (await api(`/pages/${owned.id}/draft`)).payload.data.draft
  assert.ok(current.content.links.findIndex(link => link.title === title) > current.content.links.findIndex(link => link.title === secondTitle), 'Moving down targets the next displayed link even when a hidden row separates them in storage')
  await row.getByRole('button', { name: `Edit ${title}`, exact: true }).click()
  const future = new Date(Date.now() + 86400000)
  const until = new Date(Date.now() + 172800000)
  const localDate = value => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value).replace(' ', 'T')
  await page.getByLabel('Visible from').fill(localDate(future))
  await page.getByLabel('Visible until').fill(localDate(until))
  await page.getByRole('dialog').getByRole('button', { name: 'Save link', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await row.getByText('Upcoming', { exact: true }).waitFor()
  assert.equal(await previewLink.count(), 0)
  current = (await api(`/pages/${owned.id}/draft`)).payload.data.draft
  created = current.content.links.find(link => link.title === title)
  assert.ok(Math.abs(created.startsAt - future.getTime()) < 60000, 'Local schedule is sent as UTC epoch milliseconds')
  await page.getByLabel('Search links').fill(title)
  assert.equal(await page.locator('.link-manager-row').count(), 1)
  await page.getByLabel('Link status').selectOption('hidden')
  await page.getByText('No links match your filters.', { exact: true }).waitFor()
  await page.getByLabel('Link status').selectOption('all')
  await page.getByLabel('Search links').fill('')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await row.getByText('Upcoming', { exact: true }).waitFor()
  await row.getByRole('checkbox', { name: `Select ${title}`, exact: true }).check()
  const secondRow = page.locator('.link-manager-row').filter({ has: page.getByRole('heading', { name: secondTitle, exact: true }) })
  await secondRow.getByRole('checkbox', { name: `Select ${secondTitle}`, exact: true }).check()
  let mutation = page.waitForResponse(response => response.url().endsWith(`/pages/${owned.id}/draft`) && response.request().method() === 'PUT')
  await page.getByRole('button', { name: 'Hide', exact: true }).click()
  assert.equal((await mutation).status(), 200)
  current = (await api(`/pages/${owned.id}/draft`)).payload.data.draft
  assert.equal(current.content.links.filter(link => [title, secondTitle].includes(link.title) && !link.isVisible).length, 2)
  mutation = page.waitForResponse(response => response.url().endsWith(`/pages/${owned.id}/draft`) && response.request().method() === 'PUT')
  await page.getByRole('button', { name: 'Show', exact: true }).click()
  assert.equal((await mutation).status(), 200)
  mutation = page.waitForResponse(response => response.url().endsWith(`/pages/${owned.id}/draft`) && response.request().method() === 'PUT')
  await page.getByLabel('Move selected to group').selectOption('ungrouped')
  assert.equal((await mutation).status(), 200)
  current = (await api(`/pages/${owned.id}/draft`)).payload.data.draft
  assert.ok(current.content.links.filter(link => [title, secondTitle].includes(link.title)).every(link => link.groupId === null))
  await row.getByRole('checkbox', { name: `Select ${title}`, exact: true }).uncheck()
  await page.getByRole('button', { name: 'Remove selected links', exact: true }).click()
  await page.route('**/api/v1/pages/*/draft', async route => {
    if (route.request().method() === 'PUT') { await route.fulfill({ status: 500, contentType: 'application/json', json: { error: { code: 'INTERNAL', message: 'Could not remove links. Try again.' } } }); await page.unroute('**/api/v1/pages/*/draft') }
    else await route.continue()
  })
  await page.getByRole('dialog').getByRole('button', { name: 'Remove links', exact: true }).click()
  await page.getByRole('dialog').getByRole('alert').getByText(/Could not remove links/).waitFor()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove links', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal((await api(`/pages/${owned.id}/draft`)).payload.data.draft.content.links.some(link => link.title === secondTitle), false)
  await page.route('**/api/v1/pages/*/draft', async route => {
    if (route.request().method() === 'PUT') { await route.fulfill({ status: 412, contentType: 'application/json', json: { error: { code: 'PRECONDITION_FAILED', message: 'Draft changed in another tab.' } } }); await page.unroute('**/api/v1/pages/*/draft') }
    else await route.continue()
  })
  await row.getByRole('button', { name: `Hide ${title}`, exact: true }).click()
  await page.getByRole('alert').getByText(/another tab/).waitFor()
  assert.equal((await api(`/pages/${owned.id}/draft`)).payload.data.draft.content.links.find(link => link.id === created.id).isVisible, true)
  await page.getByRole('button', { name: 'Load latest draft', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Load latest draft', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No whole-page horizontal overflow')
  await page.evaluate(() => window.scrollTo(0, 500))
  assert.equal(Math.round((await page.locator('.creator-topbar').boundingBox()).y), 0, 'Header stays fixed while scrolling')
  await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement?.blur() })
  await page.screenshot({ path: 'output/playwright/creator-links-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: 'output/playwright/creator-links-desktop.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log('PASS links: real private draft saves, canonical groups, displayed-row ordering, visibility, schedules, filters, bulk actions, failed deletion retry, reload, stale-write recovery, mobile and sticky header')
} finally {
  if (saved && owned && !process.env.EXPECT_RED) {
    const latest = (await api(`/pages/${owned.id}/draft`)).payload.data.draft
    assert.equal((await api(`/pages/${owned.id}/draft`, 'PUT', { content: saved.content, updatedAt: latest.updatedAt })).status, 200, 'Restore disposable fixture')
  }
  await browser.close()
}
