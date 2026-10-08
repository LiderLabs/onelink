import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const origin = process.env.BASE_URL ?? 'http://localhost:5173'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
page.setDefaultTimeout(10000)
await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort())
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Connect more of you.', exact: true }).waitFor()
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await page.evaluate(() => scrollTo({ top: 1700, behavior: 'instant' }))
    const nav = page.getByRole('navigation', { name: 'Main navigation' })
    const bounds = await nav.boundingBox()
    assert.ok(bounds.y >= 0 && bounds.y < 40, 'Navigation remains pinned to the top after deep scrolling')
    assert.equal(await nav.getByRole('link', { name: 'Sign in', exact: true }).isVisible(), true)
    assert.ok(await nav.getByRole('link', { name: 'Sign in', exact: true }).evaluate(el => {
      const box = el.getBoundingClientRect()
      return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
    }), 'Pinned auth buttons stay unobstructed and clickable')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelector('.landing-hero-copy h1')?.getAnimations().some(animation => animation.playState === 'running'))
  await page.evaluate(() => scrollTo({ top: 1150, behavior: 'instant' }))
  await page.waitForFunction(() => [...document.querySelectorAll('.landing-destination')].some(el => el.getAnimations().some(animation => animation.playState === 'running')), undefined, { timeout: 2000 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForFunction(() => document.querySelector('.landing-page').getAnimations({ subtree: true }).length === 0)
  assert.ok(await page.locator('.landing-destination').evaluateAll(elements => elements.every(el => getComputedStyle(el).opacity === '1')), 'Reduced motion restores all content to full visibility')
  await page.screenshot({ path: 'output/playwright/landing-sticky-nav.png' })
  const nav = page.getByRole('navigation', { name: 'Main navigation' })
  await nav.getByRole('link', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(origin + '/login')
  await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor()
  assert.equal(await page.locator('.landing-masthead').count(), 0, 'Landing chrome and animation effects clean up when leaving')
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Connect more of you.', exact: true }).waitFor()
  assert.equal(await page.locator('.landing-page').evaluate(el => el.getAnimations({ subtree: true }).length), 0, 'Reduced motion also applies on first render')
  assert.deepEqual(errors, [])
  console.log('PASS Landing motion: sticky accessible navigation at 320–1440px, hero/scroll animations, dynamic and initial reduced motion, clean route transitions, no overflow/errors.')
} finally { await browser.close() }
