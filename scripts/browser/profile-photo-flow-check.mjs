// Real end-to-end browser check for the profile photo (R1.3), Task 6.
//
//   node scripts/browser/run-check.mjs scripts/browser/profile-photo-flow-check.mjs
//
// The image and UI checks isolate one layer each: decode geometry, transport
// envelopes, dialog semantics. This one drives the whole feature through a real
// browser against a real API and a real bucket — register a disposable account,
// pick a committed fixture, crop, save, reload, replace, remove — and asserts the
// things that are only true when the pieces are wired together:
//
//   * the session pointer, the upload and the precondition (`expectedAvatarKey`)
//     agree about which asset the account owns;
//   * the URL the API reports is the URL the browser renders, before and after a
//     reload;
//   * a replaced or removed file stops being served (a 404, not an orphan);
//   * a photo save never touches the unsaved identity draft beside it.
//
// Nothing is stubbed here, which is why it is the check that catches integration
// defects rather than unit ones. The pure helpers are exercised in
// `profile-photo-image-check.mjs`, and every transport envelope in
// `profile-photo-ui-check.mjs`, because those cases need a stub to be reachable at
// all. This file needs none, so it has none.
//
// The byte assertions read the request the browser ACTUALLY sent
// (`uploadResponse.request().postDataBuffer()`) rather than the app's own report of
// itself: a 512-square WebP under 240 KiB is checked against the wire, then
// cross-checked against the server's independently sniffed metadata (`width`,
// `height`, `bytes`). Two parties, one file.
//
// Requires the local stack: `npm.cmd run dev` (API on :8787) and `npm.cmd run
// dev:web` (Vite on :5173, which proxies /api so the browser sees one origin and
// credentials behave as they do in production). Sign-up must be open
// (`platform.registration_open`), and the `register_ip` rule is 5 per hour per IP,
// so this check registers exactly one account per run. A refused sign-up (the sixth
// run in an hour, a taken username, a closed switch) is reported with the API's own
// words instead of a timeout. The disposable account is left behind by design: it is
// the account whose photo the run then replaced and removed.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ORIGIN = 'http://localhost:5173'
const WIDE_FIXTURE = join(here, 'fixtures', 'source-photo.png')
const TALL_FIXTURE = join(here, 'fixtures', 'source-photo-tall.png')

/** `ME_PATH` is the route both the attach and the re-read go through. */
const ME_PATH = '/api/v1/auth/me'

/** Mirrors `AVATAR_SIZE` / `MAX_AVATAR_BYTES` in `features/media/image.ts`. */
const AVATAR_SIZE = 512
const MAX_AVATAR_BYTES = 240 * 1024

// ---------------------------------------------------------------- byte reading --

/**
 * The IHDR geometry of a PNG, or `null`.
 *
 * Used before anything else runs, to prove the fixtures are the geometry this
 * check reasons about: a regenerated 900x600 source would make "the export came out
 * 512 square" a coincidence rather than a fact.
 */
function pngSize(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24 || !signature.every((byte, index) => bytes[index] === byte)) return null
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function readUInt24LE(bytes, at) {
  return bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)
}

/**
 * The canvas geometry of a WebP, read out of the container.
 *
 * Three cases rather than "whatever Chrome emitted this time": a still export can
 * be a simple `VP8 ` lossy frame, a `VP8L` lossless one, or an extended `VP8X`
 * file, and each stores its dimensions differently. Reading the header here — rather
 * than decoding the picture again in the page — is what keeps this an assertion
 * about the bytes that left the browser.
 */
function webpSize(bytes) {
  const ascii = (at, text) => text === bytes.toString('latin1', at, at + text.length)
  if (bytes.length < 30 || !ascii(0, 'RIFF') || !ascii(8, 'WEBP')) return null

  const leaf = bytes.toString('latin1', 12, 16)
  if (leaf === 'VP8X') {
    // Canvas size, stored as two 24-bit values one LESS than the real dimensions.
    return { width: readUInt24LE(bytes, 24) + 1, height: readUInt24LE(bytes, 27) + 1 }
  }
  if (leaf === 'VP8L') {
    // A 1-byte signature then 14 bits of width and 14 of height, both minus one.
    const bits = bytes.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (leaf === 'VP8 ') {
    // The lossy frame opens with a 3-byte tag and then a fixed start code. The code
    // is FOUND rather than assumed at a fixed offset, because an encoder is free to
    // pad the tag.
    let at = -1
    for (let index = 20; index < Math.min(bytes.length - 6, 40); index += 1) {
      if (bytes[index] === 0x9d && bytes[index + 1] === 0x01 && bytes[index + 2] === 0x2a) {
        at = index
        break
      }
    }
    if (at < 0) return null
    return {
      width: bytes.readUInt16LE(at + 3) & 0x3fff,
      height: bytes.readUInt16LE(at + 5) & 0x3fff,
    }
  }
  return null
}

/**
 * The bytes the browser actually handed the transport, read back out of the Blob
 * its `XMLHttpRequest.send` was given.
 *
 * `Request.postDataBuffer()` is the obvious way to ask, and it answers `null` for an
 * XHR whose body is a Blob — Chromium never reports a binary request body to the
 * driver. So the body is captured inside the page instead (the `addInitScript`
 * below) and carried back as base64: "512 square and under 240 KiB" has to be an
 * assertion about the real bytes, not about the app's own opinion of them.
 */
async function readUploadedBlob(page, index) {
  const captured = await page.evaluate(async (at) => {
    const blob = globalThis.__photoFlowUploads?.[at]
    if (!blob) return null
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return { type: blob.type, size: blob.size, base64: btoa(binary) }
  }, index)
  if (captured === null) return null
  return { type: captured.type, size: captured.size, bytes: Buffer.from(captured.base64, 'base64') }
}

// ------------------------------------------------------------------- the flow --

export default async (page) => {
  const problems = []
  /** Records a failed assertion and keeps going, so one run names every problem. */
  const check = (condition, message) => {
    if (!condition) problems.push(message)
  }
  /** Stops a run whose next step could not mean anything (no session, no dialog). */
  const must = (condition, message) => {
    if (!condition) throw new Error(message)
  }

  /** Reads an API path as the signed-in browser — same origin, same cookie jar. */
  const readJson = async (path) => {
    const response = await page.request.get(`${ORIGIN}${path}`)
    must(response.status() === 200, `GET ${path} must succeed (got ${response.status()})`)
    return response.json()
  }

  /**
   * Waits for a public media URL to reach `expected`.
   *
   * A replaced file is removed AFTER its attach response, so the `404` is not
   * instantaneous; polling is what makes "gone" a fact rather than a race.
   */
  const waitForStatus = async (path, expected, timeoutMs = 8_000) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const status = (await page.request.get(`${ORIGIN}${path}`)).status()
      if (status === expected || Date.now() > deadline) return status
      await page.waitForTimeout(150)
    }
  }

  // --- prerequisites: the fixtures are the geometry this check assumes --------
  const wide = readFileSync(WIDE_FIXTURE)
  const tall = readFileSync(TALL_FIXTURE)
  must(
    pngSize(wide)?.width === 1200 && pngSize(wide)?.height === 800,
    'fixtures/source-photo.png must be the committed 1200x800 source (regenerate with node scripts/browser/fixtures/make-fixtures.mjs)',
  )
  must(
    pngSize(tall)?.width === 800 && pngSize(tall)?.height === 1200,
    'fixtures/source-photo-tall.png must be the committed 800x1200 source',
  )

  // A headed window shows a real `beforeunload` prompt. Accepting it is what the
  // browser's "Leave" button does; the TEXT is kept, because "the dirty identity
  // draft warns before the page unloads" is one of the guards this check is here to
  // prove still exists.
  const unloads = []
  page.on('dialog', (dialog) => {
    unloads.push({ type: dialog.type(), message: dialog.message() })
    void dialog.accept()
  })

  // Every upload body is a Blob from a canvas export, and the driver is not told
  // about binary request bodies, so the page keeps them for the assertions that
  // need real bytes. Installed before the first navigation, so the very first
  // upload is already covered.
  await page.addInitScript(() => {
    const uploads = []
    const originalSend = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.send = function send(body) {
      if (body instanceof Blob) uploads.push(body)
      return originalSend.call(this, body)
    }
    globalThis.__photoFlowUploads = uploads
  })

  // --- a disposable account, through the real sign-up form -------------------
  const suffix = Math.random().toString(36).slice(2, 8)
  const username = `photocheck${suffix}`
  const displayName = `Photo Check ${suffix}`
  const password = 'Check-the-photos-9'

  await page.goto(`${ORIGIN}/register`)
  const createAccount = page.getByRole('button', { name: 'Create account' })
  // The route can only decide between the form and the closed notice once the
  // platform settings arrive, so "no form yet" means "still loading" rather than
  // "sign-ups are closed" — waiting for one of the two is what tells them apart.
  await page.waitForFunction(
    () =>
      document.querySelector('form.auth-form') !== null ||
      document.querySelector('.auth-closed') !== null,
  )
  if ((await createAccount.count()) === 0) {
    const closed = await page.locator('.auth-closed').innerText()
    throw new Error(`/register shows no form — sign-ups are closed: ${closed.replace(/\s+/g, ' ').trim()}`)
  }
  await page.getByLabel('Username', { exact: true }).fill(username)
  await page.locator('input[name="displayName"]').fill(displayName)
  await page.getByLabel('Email', { exact: true }).fill(`${username}@example.com`)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password', { exact: true }).fill(password)
  // Sign-up can be refused for reasons the user never sees a URL for — a rate limit
  // (the `register_ip` rule is five an hour), a username already taken, a closed
  // switch. Waiting only for the redirect would turn any of those into an anonymous
  // 20-second timeout, so the form's own alert is waited for as well and quoted.
  const landed = page
    .waitForURL((url) => url.pathname === '/app/profile', { timeout: 20_000 })
    .then(() => 'landed', () => 'no-answer')
  const complaint = page.locator('.auth-notice')
  await createAccount.click()
  const outcome = await Promise.race([
    landed,
    complaint.waitFor({ state: 'visible', timeout: 20_000 }).then(() => 'refused', () => 'no-answer'),
  ])
  must(
    outcome === 'landed',
    outcome === 'refused'
      ? `the sign-up form refused this account: ${(await complaint.innerText()).replace(/\s+/g, ' ').trim()}`
      : 'creating an account must land on the profile (no answer in 20s — is the API running?)',
  )

  const bioField = page.getByLabel('Bio', { exact: true })
  await bioField.waitFor({ state: 'visible' })

  const photoInput = () => page.getByLabel('Choose profile photo', { exact: true })
  const photoActions = page.locator('.profile-photo-controls')
  const dialog = page.getByRole('dialog', { name: 'Crop your photo' })
  const saveButton = () => page.getByRole('button', { name: 'Save photo', exact: true })
  const headingPhoto = () => page.locator('.profile-nav-avatar img')

  // A brand-new account has no photo, and that state is what the rest of the run
  // is measured against: initials, no image, and nothing to remove.
  check(
    (await headingPhoto().count()) === 0,
    'a new account must show initials rather than an image element',
  )
  check(
    (await page.locator('.profile-photo-avatar').innerText()).trim() === 'PC',
    'the photo frame must fall back to the display name initials',
  )
  check(
    (await photoActions.getByRole('button', { name: 'Remove photo', exact: true }).count()) === 0,
    'a new account must not offer to remove a photo it does not have',
  )
  check(
    (await readJson('/api/v1/media/avatar')).data.media === null,
    'an account with no photo must read back no asset, not a 404',
  )

  // The draft that must survive every photo write below.
  await bioField.fill('Unsaved photo-test bio')

  /**
   * Picks a fixture, waits for the crop dialog, saves, and reports what the two
   * services answered.
   *
   * Both responses are awaited FROM the click, so neither wait can be satisfied by
   * a request some earlier step already finished — the classic way a flow check
   * passes while testing nothing.
   */
  const savePhoto = async (fixture) => {
    await photoInput().setInputFiles(fixture)
    await dialog.waitFor({ state: 'visible' })
    const [upload, attach] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().includes('/api/v1/media'),
      ),
      page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' && response.url().endsWith(ME_PATH),
      ),
      saveButton().click(),
    ])
    must(upload.status() === 201, `the upload must be accepted (got ${upload.status()})`)
    must(attach.status() === 200, `the attach must succeed (got ${attach.status()})`)

    const result = {
      asset: (await upload.json()).data,
      user: (await attach.json()).data.user,
      contentType: upload.request().headers()['content-type'],
      attachBody: JSON.parse(attach.request().postData() ?? '{}'),
      uploadIndex: (await page.evaluate(() => globalThis.__photoFlowUploads.length)) - 1,
    }
    await dialog.waitFor({ state: 'hidden' })
    return result
  }

  // --- first save: pick, crop, save ------------------------------------------
  const first = await savePhoto(WIDE_FIXTURE)

  // What left the browser, read off the wire.
  const firstWire = await readUploadedBlob(page, first.uploadIndex)
  must(firstWire !== null, 'the upload must have carried a Blob body')
  check(
    firstWire.type === 'image/webp',
    `the encode must produce a WebP (got ${firstWire.type})`,
  )
  check(
    first.contentType === firstWire.type,
    `the declared content type must be the encoded blob's own type (${first.contentType} vs ${firstWire.type})`,
  )
  const frame = webpSize(firstWire.bytes)
  check(frame !== null, 'the uploaded bytes must be a WebP container')
  check(
    frame?.width === AVATAR_SIZE && frame?.height === AVATAR_SIZE,
    `the exported upload must be ${AVATAR_SIZE} square (got ${frame?.width}x${frame?.height})`,
  )
  check(
    firstWire.bytes.length <= MAX_AVATAR_BYTES,
    `the exported upload must fit ${MAX_AVATAR_BYTES} bytes (got ${firstWire.bytes.length})`,
  )

  // ...and what the server made of those same bytes, sniffed on its own side.
  check(
    first.asset.bytes === firstWire.bytes.length,
    `the stored byte count must be the size that was sent (${first.asset.bytes} vs ${firstWire.bytes.length})`,
  )
  check(
    first.asset.width === AVATAR_SIZE && first.asset.height === AVATAR_SIZE,
    `the server must sniff a ${AVATAR_SIZE}-square image (got ${first.asset.width}x${first.asset.height})`,
  )
  check(
    first.asset.key.startsWith('avatars/'),
    `an avatar upload must mint an avatar key (got ${first.asset.key})`,
  )
  check(
    first.asset.url === `/api/v1/media/files/${first.asset.key}`,
    'the upload URL must be derived from the key it minted',
  )

  // The save response has to name the media the account now owns, and the
  // precondition it carried has to describe what was stored before it.
  check(first.user.avatarKey === first.asset.key, 'the attach must name the key the upload created')
  check(first.user.avatarUrl === first.asset.url, 'the attach must name the URL the upload created')
  check(first.attachBody.avatarKey === first.asset.key, 'the attach must send the key it was given')
  check(
    first.attachBody.expectedAvatarKey === null,
    'the first attach must state that nothing was stored before it',
  )
  check(
    (await waitForStatus(first.asset.url, 200)) === 200,
    'a saved photo must be served from its public URL',
  )

  // ...and the screen must show that, from the session rather than from the draft.
  check(
    (await headingPhoto().getAttribute('src')) === first.asset.url,
    'the heading avatar must render the URL the attach published',
  )
  check(
    (await bioField.inputValue()) === 'Unsaved photo-test bio',
    'a photo save must preserve the unsaved identity draft',
  )
  check(
    (await page.getByText('Photo saved.').count()) === 1,
    'a completed save must report itself as done',
  )
  check(
    (await photoActions.getByRole('button', { name: 'Remove photo', exact: true }).count()) === 1,
    'a saved photo must offer removal',
  )

  // --- reload: the account remembers, the browser agrees ----------------------
  // The identity draft is still dirty, which makes this the one place the
  // navigation guard has to speak up. Playwright accepts a `beforeunload` dialog on
  // its own — the same thing the browser's "Leave" button does — and the handler
  // above recorded that it was asked.
  //
  // Chromium does not surface `beforeunload` prompts in headless mode: the page's
  // JS handler still runs, but no dialog opens, so there is no event to observe. The
  // assertion is therefore skipped there rather than weakened, and the headed run
  // (the default) is the one that exercises it.
  await page.reload()
  await bioField.waitFor({ state: 'visible' })

  if (process.env.HEADLESS !== '1') {
    check(
      unloads.some((dialog) => dialog.type === 'beforeunload'),
      'a dirty identity draft must warn before the page unloads',
    )
  }
  check(
    (await headingPhoto().getAttribute('src')) === first.asset.url,
    'the saved photo must survive a reload',
  )
  check(
    (await bioField.inputValue()) === '',
    'a reload must drop the unsaved draft — nothing was ever saved',
  )

  const afterReload = await readJson(ME_PATH)
  check(
    afterReload.data.user.avatarUrl === first.asset.url,
    'the session must carry the saved photo after a reload',
  )
  const currentAvatar = await readJson('/api/v1/media/avatar')
  check(
    currentAvatar.data.media?.key === first.asset.key,
    'the avatar read must name the asset the account points at',
  )
  check(
    (currentAvatar.data.media?.id ?? '').length > 0,
    'the avatar read must supply the deletion id a reload leaves the tab without',
  )

  // --- replace: the old file is removed, not orphaned -------------------------
  await bioField.fill('Unsaved photo-test bio')

  const second = await savePhoto(TALL_FIXTURE)

  check(
    second.asset.key !== first.asset.key,
    'a replace must create a new asset rather than reuse the first',
  )
  check(second.user.avatarKey === second.asset.key, 'the replace must attach the second upload')
  check(
    second.attachBody.expectedAvatarKey === first.asset.key,
    'the replace must name the key it replaced as its precondition',
  )
  check(
    (await headingPhoto().getAttribute('src')) === second.asset.url,
    'the heading avatar must show the replacement',
  )
  check(
    (await bioField.inputValue()) === 'Unsaved photo-test bio',
    'a replace must preserve the unsaved identity draft',
  )

  // The replaced object is cleaned up AFTER its attach commits, so this waits for
  // the `404` rather than assuming it is already there.
  check(
    (await waitForStatus(first.asset.url, 404)) === 404,
    'the replaced photo must stop being served',
  )
  check(
    (await waitForStatus(second.asset.url, 200)) === 200,
    'the replacement must be served',
  )
  const afterReplace = await readJson(ME_PATH)
  check(
    afterReplace.data.user.avatarUrl === second.asset.url,
    'the session must point at the replacement, not at the photo it replaced',
  )

  // --- remove: one call, then the truth from the server -----------------------
  await photoActions.getByRole('button', { name: 'Remove photo', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: 'Remove your profile photo?' })
  await confirm.waitFor({ state: 'visible' })

  const [removal] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' && response.url().includes('/api/v1/media/'),
    ),
    confirm.getByRole('button', { name: 'Remove photo', exact: true }).click(),
  ])

  check(removal.status() === 204, `the removal must answer 204 (got ${removal.status()})`)
  check(
    removal.url().endsWith(`/api/v1/media/avatar/${second.asset.id}`),
    `the removal must delete the asset the account pointed at (got ${removal.url()})`,
  )
  check(
    (await waitForStatus(second.asset.url, 404)) === 404,
    'a removed photo must stop being served',
  )
  check(
    (await page.locator('.profile-photo-avatar').innerText()).trim() === 'PC',
    'removal must fall back to the display name initials',
  )
  check((await headingPhoto().count()) === 0, 'removal must take the image out of the heading')
  check(
    (await bioField.inputValue()) === 'Unsaved photo-test bio',
    'a removal must preserve the unsaved identity draft',
  )
  check(
    (await page.getByText('Photo removed.').count()) === 1,
    'a completed removal must report itself as done',
  )

  const afterRemoval = await readJson(ME_PATH)
  check(afterRemoval.data.user.avatarUrl === null, 'the session must drop the removed photo')
  check(
    (await readJson('/api/v1/media/avatar')).data.media === null,
    'the avatar read must report no asset once the photo is removed',
  )

  if (problems.length > 0) {
    throw new Error(`profile-photo flow check failed:\n- ${problems.join('\n- ')}`)
  }
  console.log('profile-photo flow check: register, save, reload, replace and remove all pass')
}
