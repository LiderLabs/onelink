import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
page.setDefaultTimeout(10000)
await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort())
const errors = [], writes = []
page.on('pageerror', error => errors.push(error.message))
let forgotMode = 'production', resetMode = 'success', releaseForgot, releaseReset
const token = 'development-reset-token-123456789'
await page.route('**/api/v1/**', async route => {
  const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
  const ok = data => route.fulfill({ json: { data } })
  if (path === '/public/settings') return ok({ platformName: 'OneLink', settings: { 'platform.registration_open': true }, roles: [] })
  if (path === '/auth/me') return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED', message: 'Sign in required.' } } })
  if (path === '/auth/forgot-password') {
    writes.push({ path, body: route.request().postDataJSON() })
    if (forgotMode === 'rate') return route.fulfill({ status: 429, headers: { 'retry-after': '60' }, json: { error: { code: 'RATE_LIMITED', message: 'Too many reset requests.' } } })
    if (forgotMode === 'validation') return route.fulfill({ status: 422, json: { error: { code: 'VALIDATION_ERROR', message: 'Check your email.', details: { issues: [{ path: 'email', message: 'Enter a valid email address.', code: 'invalid_format' }] } } } })
    if (forgotMode === 'offline') return route.abort()
    if (forgotMode === 'hold') await new Promise(resolve => { releaseForgot = resolve })
    return ok({ accepted: true, ...(forgotMode === 'production' ? {} : { devToken: token }) })
  }
  if (path === '/auth/reset-password') {
    writes.push({ path, body: route.request().postDataJSON() })
    if (resetMode === 'expired') return route.fulfill({ status: 400, json: { error: { code: 'BAD_REQUEST', message: 'This reset link has expired. Request a new one.' } } })
    if (resetMode === 'validation') return route.fulfill({ status: 422, json: { error: { code: 'VALIDATION_ERROR', message: 'Choose another password.', details: { issues: [{ path: 'newPassword', message: 'This password is too common.', code: 'custom' }] } } } })
    if (resetMode === 'hold') await new Promise(resolve => { releaseReset = resolve })
    return ok({ userId: 'recovery-user', username: 'recovery-user', revokedSessions: 3 })
  }
  return ok({})
})
async function fit(label) {
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label} fits ${width}px`)
    assert.equal(await page.locator('.auth-shell').count(), 1)
    const home = await page.getByRole('link', { name: 'Back to home', exact: true }).boundingBox()
    assert.ok(home && home.height >= 44 && home.y >= 0 && home.y < 120, 'Home link is visible near the top')
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}
try {
  await mkdir('output/playwright', { recursive: true })
  await page.goto(origin + '/login')
  await page.getByRole('link', { name: 'Forgot password?', exact: true }).click()
  await page.waitForURL('**/forgot-password')
  await page.getByRole('heading', { name: 'Forgot your password?', exact: true }).waitFor()
  assert.equal(await page.locator('.auth-layout-recovery').count(), 1, 'Recovery must use current auth UI')
  await fit('Forgot password')
  await page.screenshot({ path: 'output/playwright/forgot-password-form-1440.png', fullPage: true })
  const email = page.getByRole('textbox', { name: /Email address/ })
  await page.getByRole('button', { name: 'Send reset link', exact: true }).click()
  assert.equal(writes.length, 0)
  assert.equal(await email.getAttribute('aria-invalid'), 'true')
  await email.fill('invalid-email')
  await page.getByRole('button', { name: 'Send reset link', exact: true }).click()
  assert.equal(writes.length, 0)
  await email.fill('creator@example.test')
  forgotMode = 'rate'
  await page.getByRole('button', { name: 'Send reset link', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Try again in 1 min' }).waitFor()
  assert.equal(await email.inputValue(), 'creator@example.test')
  forgotMode = 'validation'
  await page.getByRole('button', { name: 'Send reset link', exact: true }).click()
  await page.getByText('Enter a valid email address.', { exact: true }).waitFor()
  assert.equal(await email.evaluate(element => document.activeElement === element), true)
  forgotMode = 'offline'
  await page.getByRole('button', { name: 'Send reset link', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Could not reach OneLink' }).waitFor()
  forgotMode = 'production'
  await email.fill(' creator@example.test ')
  await page.getByRole('button', { name: 'Send reset link', exact: true }).click()
  await page.getByRole('heading', { name: 'Reset link requested', exact: true }).waitFor()
  assert.deepEqual(writes.at(-1).body, { email: 'creator@example.test' })
  assert.equal(await page.getByRole('link', { name: 'Open development reset link', exact: true }).count(), 0)
  assert.equal(await page.getByText(/email (was|has been) sent|check your inbox/i).count(), 0, 'Do not claim a message was delivered')
  await page.getByRole('button', { name: 'Use a different email', exact: true }).click()
  assert.equal(await email.evaluate(element => document.activeElement === element), true)
  forgotMode = 'hold'
  const beforeForgot = writes.length
  await email.fill('creator@example.test')
  await page.locator('form.auth-form').evaluate(form => { form.requestSubmit(); form.requestSubmit() })
  await page.waitForFunction(() => document.querySelector('button.auth-submit')?.disabled === true)
  while (!releaseForgot) await page.waitForTimeout(20)
  assert.equal(writes.length, beforeForgot + 1, 'One request while pending')
  assert.equal(await email.isDisabled(), true)
  releaseForgot()
  const devLink = page.getByRole('link', { name: 'Open development reset link', exact: true })
  await devLink.waitFor()
  assert.equal(await devLink.getAttribute('href'), `/reset-password?token=${token}`)
  assert.equal(await page.getByText(token, { exact: false }).count(), 0, 'Token stays out of visible copy')
  await page.screenshot({ path: 'output/playwright/forgot-password-1440.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'output/playwright/forgot-password-390.png', fullPage: true })
  await devLink.click()
  await page.getByRole('heading', { name: 'Choose a new password', exact: true }).waitFor()
  await fit('Reset password')
  await page.screenshot({ path: 'output/playwright/reset-password-form-1440.png', fullPage: true })
  const password = page.locator('input[name="password"]'), confirm = page.locator('input[name="confirmPassword"]')
  await password.fill('short')
  await confirm.fill('different')
  const beforeReset = writes.length
  await page.getByRole('button', { name: 'Reset password', exact: true }).click()
  assert.equal(writes.length, beforeReset)
  await password.fill('FreshPassword123!')
  await confirm.fill('FreshPassword123!')
  await page.getByRole('button', { name: 'Show new password', exact: true }).click()
  assert.equal(await password.getAttribute('type'), 'text')
  await page.getByRole('button', { name: 'Hide new password', exact: true }).click()
  resetMode = 'validation'
  await page.getByRole('button', { name: 'Reset password', exact: true }).click()
  await page.getByText('This password is too common.', { exact: true }).waitFor()
  resetMode = 'expired'
  await page.getByRole('button', { name: 'Reset password', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'expired' }).waitFor()
  await page.getByRole('link', { name: 'Request a new link', exact: true }).waitFor()
  resetMode = 'hold'
  const beforeSuccess = writes.length
  await page.locator('form.auth-form').evaluate(form => { form.requestSubmit(); form.requestSubmit() })
  while (!releaseReset) await page.waitForTimeout(20)
  assert.equal(writes.length, beforeSuccess + 1)
  assert.equal(await password.isDisabled(), true)
  releaseReset()
  await page.getByRole('heading', { name: 'Password updated', exact: true }).waitFor()
  assert.deepEqual(writes.at(-1).body, { token, newPassword: 'FreshPassword123!' })
  assert.equal(await page.locator('input[type="password"]').count(), 0)
  await page.getByRole('link', { name: 'Sign in with your new password', exact: true }).click()
  await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor()
  await page.goto(origin + '/reset-password')
  await page.getByRole('heading', { name: 'Request a new reset link', exact: true }).waitFor()
  assert.equal(await page.locator('form.auth-form').count(), 0)
  await fit('Missing reset token')
  await page.getByRole('link', { name: 'Request a new link', exact: true }).click()
  await page.getByRole('heading', { name: 'Forgot your password?', exact: true }).waitFor()
  await page.getByRole('link', { name: 'Back to home', exact: true }).click()
  await page.waitForURL(origin + '/')
  assert.deepEqual(errors, [])
  console.log('PASS password recovery: current UI, validation, rate/network/server errors, pending locks, safe development link, reset payload/success/expired/missing states, navigation, 320–1440px')
} finally { await browser.close() }
