import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const baseUrl = process.env.BASE_URL ?? 'http://localhost:5173'
const now = Date.now()
const pageId = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const linkId = '01ARZ3NDEKTSV4RRFFQ69G5FAW'
const secondLinkId = '01ARZ3NDEKTSV4RRFFQ69G5FAX'

const activeUser = {
  id: 'fixture-user',
  email: 'acceptance@example.test',
  username: 'acceptance',
  displayName: 'Acceptance User',
  bio: 'A fixture profile.',
  location: 'Lagos, Nigeria',
  pronouns: 'they/them',
  avatarKey: null,
  avatarUrl: null,
  role: 'user',
  status: 'active',
  statusReason: null,
  suspendedUntil: null,
  suspendedPermanently: false,
  emailVerified: true,
  requirePasswordChange: false,
  lastLoginAt: now,
  loginCount: 1,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  sessionId: 'fixture-session',
  sessionExpiresAt: now + 8 * 60 * 60 * 1000,
  impersonatedBy: null,
}

const publishedPage = {
  id: pageId,
  slug: 'acceptance',
  title: 'A good place to begin',
  bio: 'Everything I make, in one place.',
  theme: 'light',
  layout: 'list',
  accentColor: '#d3a84c',
  showBranding: true,
  status: 'published',
  moderationStatus: 'visible',
  visibility: 'public',
  revision: 2,
  unpublishedChanges: false,
  publishedAt: now,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
}

const secondPage = {
  ...publishedPage,
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
  slug: 'notes',
  title: 'Notes',
  status: 'draft',
  revision: null,
  publishedAt: null,
}

const links = [
  {
    id: linkId,
    title: 'My portfolio',
    url: 'https://example.test/work',
    domain: 'example.test',
    description: 'Selected projects.',
    icon: null,
    position: 0,
    isVisible: true,
    startsAt: null,
    endsAt: null,
    groupId: null,
    openInNewTab: true,
    thumbnailKey: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: secondLinkId,
    title: 'Latest video',
    url: 'https://example.test/video',
    domain: 'example.test',
    description: null,
    icon: null,
    position: 1,
    isVisible: true,
    startsAt: null,
    endsAt: null,
    groupId: null,
    openInNewTab: false,
    thumbnailKey: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  },
]

let draftContent = {
  v: 1,
  page: {
    title: publishedPage.title,
    bio: publishedPage.bio,
    theme: publishedPage.theme,
    layout: publishedPage.layout,
    accentColor: publishedPage.accentColor,
    showBranding: publishedPage.showBranding,
  },
  groups: [],
  links: links.map(({ id, title, url, description, icon, isVisible, groupId, openInNewTab, thumbnailKey, startsAt, endsAt }) => ({
    id, title, url, description, icon, isVisible, groupId, openInNewTab, thumbnailKey, startsAt, endsAt,
  })),
}
let draftUpdatedAt = null
let draftUnpublishedChanges = false

const publicPage = {
  slug: publishedPage.slug,
  title: publishedPage.title,
  bio: publishedPage.bio,
  theme: publishedPage.theme,
  layout: publishedPage.layout,
  accentColor: publishedPage.accentColor,
  showBranding: publishedPage.showBranding,
  owner: {
    username: activeUser.username,
    displayName: activeUser.displayName,
    avatarUrl: null,
    bio: activeUser.bio,
    location: activeUser.location,
    pronouns: activeUser.pronouns,
    socials: [{ platform: 'instagram', url: 'https://instagram.com/acceptance', position: 0 }],
  },
  links,
  groups: [],
}

let currentUser = null
let maintenanceMode = false
let fault = null
let pageItems = [publishedPage, secondPage]
const calls = []
const createPayloads = []
const reorderPayloads = []
let successfulCreate = false
let socials = [
  { id: 'social-1', platform: 'instagram', url: 'https://instagram.com/acceptance', position: 0, isVisible: true, createdAt: now, updatedAt: now },
  { id: 'social-2', platform: 'github', url: 'https://github.com/acceptance', position: 1, isVisible: false, createdAt: now, updatedAt: now },
]

function envelope(data, meta) {
  return { data, ...(meta ? { meta } : {}) }
}

function apiError(code, message, details) {
  return { error: { code, message, ...(details ? { details } : {}) } }
}

function matchesFault(path, method) {
  return fault && fault.path === path && fault.method === method
}

function queueFault(path, method, status, code, message, options = {}) {
  const { times, ...faultOptions } = options
  fault = {
    path,
    method,
    status,
    code,
    message,
    remaining: times ?? (method === 'GET' ? 2 : 1),
    ...faultOptions,
  }
}

async function respond(route, status, body, headers = {}) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: body === null ? '' : JSON.stringify(body),
  })
}

async function handleApi(route) {
  const request = route.request()
  const url = new URL(request.url())
  const path = url.pathname.replace(/^\/api\/v1/, '')
  const method = request.method()
  calls.push({ path, method })
  if (method === 'POST' && path === '/pages') createPayloads.push(request.postDataJSON())

  if (matchesFault(path, method)) {
    const queued = fault
    fault = queued.remaining > 1 ? { ...queued, remaining: queued.remaining - 1 } : null
    if (queued.network) {
      await route.abort('failed')
      return
    }
    await respond(route, queued.status, apiError(queued.code, queued.message, queued.details), queued.retryAfter
      ? { 'retry-after': String(queued.retryAfter) }
      : {})
    return
  }

  if (method === 'GET' && path === '/public/settings') {
    await respond(route, 200, envelope({
      platformName: 'OneLink',
      settings: {
        'platform.registration_open': true,
        'platform.maintenance_mode': maintenanceMode,
        'platform.maintenance_message': maintenanceMode ? 'Read-only for acceptance coverage.' : '',
      },
      roles: [],
    }))
    return
  }
  if (method === 'GET' && path === '/auth/me') {
    if (!currentUser) {
      await respond(route, 401, apiError('UNAUTHENTICATED', 'Sign in to continue.'))
      return
    }
    await respond(route, 200, envelope({
      user: currentUser,
      capabilities: [],
      platformName: 'OneLink',
      serverTime: Date.now(),
    }))
    return
  }
  if (method === 'GET' && path === '/pages/mine') {
    await respond(route, 200, envelope(pageItems, { page: 1, limit: 12, total: pageItems.length, totalPages: 1 }))
    return
  }
  if (method === 'GET' && path === '/pages/slug-available') {
    const slug = url.searchParams.get('slug') ?? ''
    await respond(route, 200, envelope({ slug, available: true, reason: null }))
    return
  }
  if (method === 'GET' && path === `/pages/${pageId}`) {
    await respond(route, 200, envelope({ page: publishedPage, links }))
    return
  }
  if (method === 'GET' && path === `/pages/${pageId}/links`) {
    await respond(route, 200, envelope({ links: url.searchParams.get('trashed') === '1' ? [] : links }))
    return
  }
  if (method === 'GET' && path === `/pages/${pageId}/draft`) {
    await respond(route, 200, envelope({ draft: { content: draftContent, updatedAt: draftUpdatedAt, unpublishedChanges: draftUnpublishedChanges } }))
    return
  }
  if (method === 'PUT' && path === `/pages/${pageId}/draft`) {
    const body = request.postDataJSON()
    draftContent = body.content
    draftUpdatedAt = Date.now()
    draftUnpublishedChanges = true
    pageItems = pageItems.map((item) => item.id === pageId ? { ...item, unpublishedChanges: true } : item)
    await respond(route, 200, envelope({ draft: { content: draftContent, updatedAt: draftUpdatedAt, unpublishedChanges: true } }))
    return
  }
  if (method === 'GET' && path === `/pages/${pageId}/preview`) {
    await respond(route, 200, envelope({ page: publicPage }))
    return
  }
  if (method === 'GET' && path === `/pages/${pageId}/revisions`) {
    await respond(route, 200, envelope({ revisions: [] }))
    return
  }
  if (method === 'GET' && path.startsWith('/public/pages/')) {
    const slug = decodeURIComponent(path.slice('/public/pages/'.length))
    if (slug === publicPage.slug) {
      await respond(route, 200, envelope({ page: publicPage }))
    } else {
      await respond(route, 404, apiError('NOT_FOUND', 'This page could not be found.'))
    }
    return
  }
  if (method === 'GET' && path === '/profile/socials') {
    await respond(route, 200, envelope({ socials }))
    return
  }
  if (method === 'PUT' && path === '/profile/socials/order') {
    const body = request.postDataJSON()
    reorderPayloads.push(body)
    const byId = new Map(socials.map(social => [social.id, social]))
    socials = body.socialIds.map((id, position) => {
      const social = byId.get(id)
      if (!social) throw new Error(`Unknown social id in reorder fixture: ${id}`)
      return { ...social, position }
    })
    await respond(route, 200, envelope({ socials }))
    return
  }
  if (method === 'PATCH' && path === '/auth/me') {
    const body = request.postDataJSON()
    if (typeof body.displayName === 'string') currentUser = { ...currentUser, displayName: body.displayName.trim(), updatedAt: Date.now() }
    await respond(route, 200, envelope({ user: currentUser }))
    return
  }
  if (method === 'POST' && path === '/pages') {
    if (successfulCreate) {
      successfulCreate = false
      await respond(route, 201, envelope(publishedPage))
      return
    }
    await respond(route, 503, apiError('MAINTENANCE', 'Changes are paused during maintenance.'))
    return
  }

  await respond(route, 404, apiError('NOT_FOUND', `No browser fixture for ${method} ${path}.`))
}

function setUser(kind = 'active') {
  if (kind === 'anonymous') {
    currentUser = null
    return
  }
  const overrides = {
    forced: { requirePasswordChange: true },
    pending: { status: 'pending' },
    suspended: { status: 'suspended', statusReason: 'Review pending.' },
    impersonated: { impersonatedBy: 'staff-fixture' },
  }
  currentUser = { ...activeUser, ...(overrides[kind] ?? {}) }
}

async function visit(page, path) {
  await page.goto(new URL(path, baseUrl).href)
}

/** Poll a fixture-side condition (the editor autosaves, so "saved" is async). */
async function waitUntil(check, { timeout = 6000, interval = 60 } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
  throw new Error('Timed out waiting for condition')
}

async function setViewport(page, width) {
  await page.setViewportSize({ width, height: 900 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(80)
  const report = await page.evaluate(() => {
    const vw = window.innerWidth
    const overflow = document.documentElement.scrollWidth <= vw
    const offenders = []
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.right > vw + 1 || r.left < -1) {
        const cls = typeof el.className === 'string' ? el.className : ''
        offenders.push(`${el.tagName.toLowerCase()}[${cls.slice(0, 70)}] right=${Math.round(r.right)}`)
        if (offenders.length >= 10) break
      }
    }
    return { overflow, offenders }
  })
  assert.equal(report.overflow, true, `horizontal overflow at ${width}px on ${new URL(page.url()).pathname} :: ${report.offenders.join(' | ')}`)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.setDefaultTimeout(7000)
page.setDefaultNavigationTimeout(10000)
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))
await page.route('**/api/v1/**', handleApi)

try {
  setUser('anonymous')
  await visit(page, '/app/pages')
  await page.waitForURL((url) => url.pathname === '/login')
  assert.match(new URL(page.url()).searchParams.get('next') ?? '', /^\/app\/pages$/)

  setUser()
  await visit(page, '/app/profile')
  await page.waitForURL((url) => url.pathname === '/app/editor/profile')
  await page.getByLabel('Display name', { exact: true }).waitFor()
  await visit(page, '/app/socials')
  await page.waitForURL((url) => url.pathname === '/app/editor/profile')
  await page.getByRole('heading', { name: 'Social links', exact: true }).waitFor()
  pageItems = []
  await visit(page, '/app')
  await page.getByRole('heading', { name: 'Acceptance User', exact: true }).waitFor()
  assert.ok(await page.getByText('@acceptance', { exact: true }).isVisible())
  await visit(page, '/app/editor/profile')
  await page.getByLabel('Display name', { exact: true }).waitFor()
  await page.getByRole('heading', { name: 'Social links', exact: true }).waitFor()
  pageItems = [publishedPage, secondPage]
  await visit(page, '/app')
  await page.getByRole('heading', { name: /welcome, acceptance user/i }).waitFor()
  assert.ok(await page.getByText('Your page is live', { exact: true }).isVisible())
  await page.getByRole('heading', { name: 'Your Links (2)', exact: true }).waitFor()
  assert.ok(await page.getByText('My portfolio', { exact: true }).isVisible())
  assert.ok(await page.getByText('Views, clicks, and contact submissions are not collected in this release, so there is no activity feed to show.').isVisible())
  assert.equal(await page.getByRole('button', { name: 'Publish', exact: true }).isDisabled(), true)
  assert.equal(await page.getByText('12,345').count(), 0)
  await visit(page, `/app/editor/links?page=${pageId}`)
  await page.getByRole('heading', { name: 'Manage Links', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Hide My portfolio', exact: true }).click()
  await waitUntil(() => draftContent.links[0].isVisible === false)
  assert.equal(await page.getByRole('button', { name: 'Publish', exact: true }).isEnabled(), true)
  await page.getByRole('button', { name: 'Show My portfolio', exact: true }).click()
  await waitUntil(() => draftContent.links[0].isVisible === true)
  await page.getByRole('button', { name: 'Move My portfolio down', exact: true }).click()
  await waitUntil(() => draftContent.links[0].id === secondLinkId)
  await page.getByRole('button', { name: 'Move My portfolio up', exact: true }).click()
  await waitUntil(() => draftContent.links[0].id === linkId)
  await page.getByRole('button', { name: 'Delete My portfolio', exact: true }).click()
  const linkDeleteDialog = page.getByRole('dialog', { name: /delete/i })
  await linkDeleteDialog.waitFor()
  await linkDeleteDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await linkDeleteDialog.waitFor({ state: 'hidden' })
  for (const width of [320, 375, 768, 1280]) await setViewport(page, width)

  await setViewport(page, 1440)
  await visit(page, '/app/pages')
  await page.getByRole('heading', { name: 'My pages', exact: true }).waitFor()
  assert.ok(await page.getByRole('link', { name: 'A good place to begin' }).isVisible())
  await page.getByRole('link', { name: 'A good place to begin' }).click()
  await page.getByRole('heading', { name: 'Manage Links', exact: true }).waitFor()
  await page.getByRole('tablist', { name: 'Editor sections' }).waitFor()
  await page.getByRole('tab', { name: 'Analytics', exact: true }).click()
  await page.getByRole('heading', { name: 'Analytics', exact: true }).waitFor()
  assert.ok(await page.getByText(/does not currently record page views/i).isVisible())
  assert.ok(await page.getByText('Not collected', { exact: true }).first().isVisible())
  await visit(page, `/app/editor/links?page=${pageId}`)
  await page.getByRole('heading', { name: 'Manage Links', exact: true }).waitFor()
  for (const width of [320, 375, 768, 1280]) await setViewport(page, width)
  await setViewport(page, 1440)
  await page.getByRole('tab', { name: 'Links', exact: true }).click()
  assert.equal(new URL(page.url()).pathname, '/app/editor/links')
  await page.getByRole('button', { name: 'Add Link', exact: true }).click()
  const linkDialog = page.getByRole('dialog', { name: 'Add Link', exact: true })
  await linkDialog.waitFor()
  await linkDialog.getByLabel('URL', { exact: true }).fill('https://example.test/new-destination')
  await linkDialog.getByLabel('Title', { exact: true }).fill('New destination')
  await linkDialog.getByLabel('Description (optional)', { exact: true }).fill('A new link from the editor.')
  await linkDialog.getByRole('button', { name: 'Add Link', exact: true }).click()
  await linkDialog.waitFor({ state: 'hidden' })
  await page.getByText('New destination', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Delete New destination', exact: true }).click()
  const deleteDialog = page.getByRole('dialog', { name: /delete/i })
  await deleteDialog.waitFor()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await deleteDialog.waitFor({ state: 'hidden' })

  await visit(page, '/p/acceptance')
  await page.getByRole('heading', { name: 'A good place to begin', exact: true }).waitFor()
  assert.ok(await page.getByText('@acceptance', { exact: true }).isVisible())
  assert.ok(await page.getByRole('link', { name: /my portfolio/i }).isVisible())
  assert.equal(await page.getByRole('link', { name: /my portfolio/i }).getAttribute('target'), '_blank')
  await visit(page, '/p/missing-address')
  await page.getByText('This page isn’t available', { exact: true }).waitFor()

  await visit(page, '/app/editor/profile')
  await page.getByRole('heading', { name: 'Social links', exact: true }).waitFor()
  await page.getByRole('region', { name: 'Live profile preview', exact: true }).waitFor()
  const profilePreview = page.getByRole('region', { name: 'Live profile preview', exact: true })
  await profilePreview.getByRole('button', { name: 'Desktop', exact: true }).click()
  assert.ok(await profilePreview.locator('.profile-preview-page.is-desktop').isVisible())
  await profilePreview.getByRole('button', { name: 'Mobile', exact: true }).click()
  assert.ok(await profilePreview.locator('.profile-preview-page.is-mobile').isVisible())
  const moveInstagramDown = page.getByRole('button', { name: 'Move the Instagram link down', exact: true })
  await moveInstagramDown.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('status').filter({ hasText: 'Order saved.' }).waitFor()
  assert.deepEqual(reorderPayloads.at(-1).socialIds, ['social-2', 'social-1'])
  assert.match(await page.locator('.profile-social-row').first().innerText(), /GitHub#1Hidden/)
  const displayName = page.getByLabel('Display name', { exact: true })
  await displayName.fill('Drafted Name')
  await page.getByRole('region', { name: 'Live profile preview', exact: true }).getByRole('heading', { name: 'Drafted Name', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Undo changes', exact: true }).click()
  assert.equal(await displayName.inputValue(), 'Acceptance User')
  await displayName.fill('  Normalized Name  ')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Your profile details are up to date.' }).waitFor()
  assert.equal(await displayName.inputValue(), 'Normalized Name')
  assert.equal(currentUser.displayName, 'Normalized Name')
  setUser()

  await visit(page, '/app/settings')
  await page.waitForURL((url) => url.pathname === '/app/editor/settings')
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor()
  for (const label of ['Bring your own address', 'Contact, newsletter & team']) {
    assert.ok(await page.getByRole('heading', { name: label, exact: true }).isVisible(), `${label} panel is visible`)
  }
  assert.ok(await page.getByText('Not saved yet', { exact: false }).first().isVisible())
  await page.getByRole('button', { name: 'Create QR code', exact: true }).click()
  await page.getByRole('region', { name: 'QR code options', exact: true }).waitFor()
  assert.ok(await page.locator('canvas[aria-label^="QR code for"]').isVisible())
  assert.ok(await page.getByRole('button', { name: 'Download SVG', exact: true }).isEnabled())
  await visit(page, '/app/submissions')
  await page.getByRole('heading', { name: 'Submissions', exact: true }).waitFor()
  assert.ok(await page.getByText(/does not accept contact-form submissions/i).isVisible())
  assert.equal(await page.getByRole('button', { name: /export csv/i }).isDisabled(), true)

  const forbiddenPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  forbiddenPage.setDefaultTimeout(7000)
  forbiddenPage.setDefaultNavigationTimeout(10000)
  await forbiddenPage.route('**/api/v1/**', handleApi)
  setUser()
  queueFault('/profile/socials', 'GET', 403, 'FORBIDDEN', 'Social links are not available for this account.')
  await visit(forbiddenPage, '/app#socials')
  await forbiddenPage.getByRole('heading', { name: 'Social links', exact: true }).waitFor()
  const forbiddenNotice = forbiddenPage.getByRole('alert').filter({ hasText: 'FORBIDDEN' })
  await forbiddenNotice.waitFor()
  assert.ok((await forbiddenNotice.innerText()).includes('Social links are not available for this account.'))
  assert.equal(await forbiddenNotice.getByRole('button', { name: /load.*again|retry/i }).count(), 0)
  await forbiddenPage.close()

  queueFault(`/pages/${pageId}/draft`, 'GET', 404, 'NOT_FOUND', 'Page unavailable.')
  await visit(page, `/app/editor/links?page=${pageId}`)
  await page.getByRole('alert').filter({ hasText: 'Page unavailable.' }).waitFor()

  queueFault(`/pages/${pageId}`, 'PATCH', 409, 'CONFLICT', 'This address has changed elsewhere.')
  await visit(page, `/app/editor/settings?page=${pageId}`)
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor()
  const editorAddress = page.getByLabel('Page address', { exact: true })
  await editorAddress.fill('renamed-address')
  await page.getByRole('status').filter({ hasText: 'This address is available.' }).waitFor()
  await page.getByRole('button', { name: 'Change address', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'This address has changed elsewhere.' }).waitFor()
  assert.equal(await editorAddress.inputValue(), 'renamed-address')

  queueFault('/pages/mine', 'GET', 429, 'RATE_LIMITED', 'Too many requests.', { retryAfter: 2 })
  await visit(page, '/app/pages')
  const limited = page.getByRole('button', { name: /load your pages again in 2s/i })
  await limited.waitFor()
  assert.equal(await limited.isDisabled(), true)
  await page.waitForTimeout(2200)
  await page.getByRole('button', { name: 'Load your pages again', exact: true }).click()
  await page.getByRole('heading', { name: 'My pages', exact: true }).waitFor()

  queueFault(`/public/pages/${publishedPage.slug}`, 'GET', 0, 'NETWORK', 'Network error.', { network: true })
  await visit(page, '/acceptance')
  await page.getByRole('button', { name: 'Try loading this page again', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Try loading this page again', exact: true }).click()
  await page.getByRole('heading', { name: 'A good place to begin', exact: true }).waitFor()

  queueFault('/pages/mine', 'GET', 401, 'UNAUTHENTICATED', 'Session expired.')
  await visit(page, '/app/pages')
  await page.waitForURL((url) => url.pathname === '/login')
  assert.match(new URL(page.url()).searchParams.get('next') ?? '', /^\/app\/pages$/)

  setUser('forced')
  await visit(page, '/app/pages')
  await page.waitForURL((url) => url.pathname === '/app/editor/profile')
  await page.getByRole('alert').filter({ hasText: 'Password change required' }).waitFor()

  setUser('pending')
  await visit(page, '/app/pages')
  await page.waitForURL((url) => url.pathname === '/app/editor/profile')
  await page.getByRole('alert').filter({ hasText: 'Account pending' }).waitFor()

  setUser('suspended')
  await visit(page, '/app/pages')
  await page.waitForURL((url) => url.pathname === '/app/editor/profile')
  assert.ok(await page.getByRole('alert').filter({ hasText: 'Account suspended' }).first().isVisible())

  setUser('impersonated')
  await visit(page, '/app')
  await page.waitForURL((url) => url.pathname === '/app/editor/profile')
  await page.getByText('Read-only support session').waitFor()
  await page.getByLabel('Display name', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Display name', { exact: true }).isDisabled(), true)
  await visit(page, '/app#socials')
  await page.getByRole('heading', { name: 'Social links', exact: true }).waitFor()

  setUser()
  maintenanceMode = true
  await visit(page, '/app/pages/new')
  await page.getByRole('status').filter({ hasText: 'Read-only' }).waitFor()
  const pageTitle = page.getByLabel('Page title', { exact: true })
  await pageTitle.fill('Maintenance draft')
  const createCallsBefore = calls.filter((call) => call.path === '/pages' && call.method === 'POST').length
  await page.getByRole('button', { name: 'Create page', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Changes are paused during maintenance.' }).waitFor()
  assert.equal(await pageTitle.inputValue(), 'Maintenance draft')
  assert.equal(calls.filter((call) => call.path === '/pages' && call.method === 'POST').length, createCallsBefore + 1)
  maintenanceMode = false

  queueFault('/pages', 'POST', 422, 'VALIDATION_ERROR', 'Check the highlighted fields.', {
    details: { issues: [{ path: 'title', message: 'Title is already in use.', code: 'custom' }] },
  })
  await visit(page, '/app/pages/new')
  const address = page.getByLabel('Page address', { exact: true })
  await address.fill('new-address')
  await page.getByRole('status').filter({ hasText: 'This address is available.' }).waitFor()
  const title = page.getByLabel('Page title', { exact: true })
  await title.fill('Rejected title')
  await page.getByRole('button', { name: 'Create page', exact: true }).click()
  await page.getByText('Title is already in use.', { exact: true }).waitFor()
  assert.equal(await title.inputValue(), 'Rejected title')
  assert.equal(await title.getAttribute('aria-invalid'), 'true')

  queueFault('/pages', 'POST', 500, 'INTERNAL', 'The request could not be completed.')
  await visit(page, '/app/pages/new')
  const failedTitle = page.getByLabel('Page title', { exact: true })
  await failedTitle.fill('Do not replay this')
  const writesBeforeFailure = calls.filter((call) => call.path === '/pages' && call.method === 'POST').length
  await page.getByRole('button', { name: 'Create page', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'The request could not be completed.' }).waitFor()
  await page.waitForTimeout(900)
  assert.equal(await failedTitle.inputValue(), 'Do not replay this')
  assert.equal(calls.filter((call) => call.path === '/pages' && call.method === 'POST').length, writesBeforeFailure + 1)

  await visit(page, '/app/pages/new')
  const dirtyAddress = page.getByLabel('Page address', { exact: true })
  await dirtyAddress.fill('dirty-address')
  await page.getByRole('status').filter({ hasText: 'This address is available.' }).waitFor()
  const beforeUnloadPrevented = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })
  assert.equal(beforeUnloadPrevented, true)
  const cancelCreate = page.getByRole('link', { name: 'Cancel', exact: true })
  await cancelCreate.click()
  const leaveDialog = page.getByRole('dialog', { name: 'Leave this new page?', exact: true })
  await leaveDialog.waitFor()
  const keepEditing = leaveDialog.getByRole('button', { name: 'Cancel', exact: true })
  await keepEditing.click()
  await leaveDialog.waitFor({ state: 'hidden' })
  assert.equal(new URL(page.url()).pathname, '/app/pages/new')
  assert.equal(await cancelCreate.evaluate(element => element === document.activeElement), true)
  await cancelCreate.click()
  await page.getByRole('dialog', { name: 'Leave this new page?', exact: true })
    .getByRole('button', { name: 'Leave page', exact: true }).click()
  await page.waitForURL(url => url.pathname === '/app/pages')

  successfulCreate = true
  await visit(page, '/app/pages/new')
  const newAddress = page.getByLabel('Page address', { exact: true })
  await newAddress.fill('  created-page  ')
  await page.getByRole('status').filter({ hasText: 'This address is available.' }).waitFor()
  await page.getByLabel('Page title', { exact: true }).fill('  Created title  ')
  await page.getByLabel('Short introduction', { exact: true }).fill('  A short bio.  ')
  await page.getByLabel('Accent colour', { exact: true }).fill('#D3A84C')
  await page.getByRole('button', { name: 'Create page', exact: true }).click()
  await page.getByRole('heading', { name: 'Manage Links', exact: true }).waitFor()
  assert.deepEqual(createPayloads.at(-1), {
    slug: 'created-page',
    title: 'Created title',
    bio: 'A short bio.',
    theme: 'light',
    layout: 'list',
    accentColor: '#D3A84C',
    showBranding: true,
  })

  await visit(page, '/app')
  await page.getByRole('heading', { name: /welcome, acceptance user/i }).waitFor()
  for (const width of [320, 375, 768, 1280]) await setViewport(page, width)

  pageItems = []
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await visit(page, '/app/pages')
  await page.getByText('A blank page, in the best way.', { exact: true }).waitFor()
  const reducedMotionName = await page.locator('.reveal').first().evaluate((element) => getComputedStyle(element).animationName)
  assert.equal(reducedMotionName, 'none')
  assert.deepEqual(pageErrors, [], `browser errors: ${pageErrors.join('; ')}`)

  console.log('PASS browser acceptance: session guards, dashboard, pages/editor, public renderer, profile/social preview, R2 unavailable states, failure matrix, and responsive/reduced-motion checks')
} finally {
  await browser.close()
}
