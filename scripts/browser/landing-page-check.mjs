import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const origin = 'http://localhost:5173'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
page.setDefaultTimeout(10000)
await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort())
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' })
  assert.equal(new URL(page.url()).pathname, '/', 'Root opens the public landing page instead of redirecting to auth')
  await page.getByRole('heading', { name: 'Connect more of you.', exact: true }).waitFor()
  assert.equal(await page.locator('.creator-sidebar, .auth-form-panel').count(), 0)
  const hrefs = await page.locator('a').evaluateAll(links => links.map(link => link.getAttribute('href')))
  assert.ok(hrefs.includes('/login') && hrefs.includes('/register'))
  assert.ok(hrefs.every(href => ['/', origin + '/', '/login', '/register', '#landing-main'].includes(href)), 'Other navigation stays on the landing page')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 })
    for (const [name, path, heading] of [['Sign in', '/login', 'Welcome back'], ['Sign up free', '/register', 'Create your free account']]) {
      await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name, exact: true }).click()
      await page.waitForURL(origin + path)
      await page.getByRole('heading', { name: heading, exact: true }).waitFor()
      const homeLink = page.getByRole('link', { name: 'Back to home', exact: true })
      assert.equal(await homeLink.getAttribute('href'), '/')
      const bounds = await homeLink.boundingBox()
      assert.ok(bounds && bounds.height >= 44 && bounds.y >= 0 && bounds.y + bounds.height <= 844, 'Home link is a visible, usable tap target without scrolling')
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Auth has no horizontal overflow at ${width}px`)
      await homeLink.click()
      await page.waitForURL(origin + '/')
      await page.getByRole('heading', { name: 'Connect more of you.', exact: true }).waitFor()
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  for (const name of ['Browse', 'Terms and conditions']) {
    await page.evaluate(() => { window.landingReloadProbe = true })
    await Promise.all([page.waitForEvent('domcontentloaded'), page.getByRole('link', { name, exact: true }).click()])
    assert.equal(new URL(page.url()).pathname, '/')
    assert.equal(await page.evaluate(() => window.landingReloadProbe), undefined, 'Secondary links trigger a full page reload')
  }
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No horizontal overflow at ${width}px`)
    const nav = page.getByRole('navigation', { name: 'Main navigation' })
    assert.equal(await nav.getByRole('link', { name: 'Sign in', exact: true }).isVisible(), true)
    assert.equal(await nav.getByRole('link', { name: 'Sign up free', exact: true }).isVisible(), true)
    for (const link of await nav.locator('a').all()) if (await link.isVisible()) assert.ok((await link.boundingBox()).height >= 44, 'Navigation offers usable tap targets')
    const backToTop = page.getByRole('button', { name: 'Back to top', exact: true })
    await backToTop.scrollIntoViewIfNeeded()
    assert.ok(await page.evaluate(() => scrollY > 500), 'Back to top is located at the bottom of the footer')
    assert.ok((await backToTop.boundingBox()).height >= 44, 'Back to top offers a usable tap target')
    await page.evaluate(() => { window.landingReturnProbe = true })
    if (width === 390) { await backToTop.focus(); await backToTop.press('Enter') }
    else await backToTop.click()
    await page.waitForFunction(() => scrollY <= 1)
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'landing-title', 'Focus returns to the hero for keyboard users')
    assert.equal(await page.evaluate(() => window.landingReturnProbe), true, 'Returning to the hero does not reload the page')
    if (width === 1440 || width === 390) await page.screenshot({ path: `output/playwright/landing-${width}.png`, fullPage: true })
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.getByRole('button', { name: 'Back to top', exact: true }).click()
  await page.waitForFunction(() => scrollY <= 1)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  // The public homepage must remain readable when the API cannot be reached.
  await page.route('**/api/v1/**', route => route.abort())
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Connect more of you.', exact: true }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/')
  await page.unroute('**/api/v1/**')
  await page.goto(origin + '/p/landing-route-check', { waitUntil: 'domcontentloaded' })
  await page.locator('.public-layout').waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Connect more of you.', exact: true }).count(), 0, 'Published page routes remain separate')
  assert.deepEqual(errors, [])
  console.log('PASS Landing: auth round trips, footer Back to top with keyboard and reduced-motion support, real reloads for secondary links, 320–1440px, offline API, public-route separation, no browser errors.')
} catch (error) {
  console.error({ url: page.url(), errors })
  throw error
} finally { await browser.close() }
