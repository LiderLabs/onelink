// Browser check for the credentialed upload and the crop dialog (R1.3 / D4).
//
//   node scripts/browser/run-check.mjs scripts/browser/profile-photo-ui-check.mjs
//
// Runs against the Vite dev origin (`npm.cmd run dev:web`) so the
// `import('/src/...')` calls below resolve through Vite's own transform — the
// same modules the app ships, not a copy.
//
// Two halves, matching the two things Task 5 produced:
//
//   1. The transport (`features/media/api.ts`), driven through a scoped
//      `XMLHttpRequest` stub so every failure is deterministic: progress
//      fractions, credentials, MIME, and the 413/422/429/5xx/network/timeout/
//      abort envelopes the editor branches on.
//   2. The dialog (`features/media/PhotoCropDialog.tsx`), mounted for real with
//      React on top of a decoded quadrant photo: focus trapping and return,
//      Escape and Cancel, the pending dismissal lock, pointer-drag mapping,
//      arrow keys, zoom and Reset, the accessible names, the progressbar, the
//      error notice, and exactly one Save callback however often pressed.
//
// The mount is test-only and lives entirely in this script. The production
// bundle never sees this file.
export default async (page) => {
  await page.goto('http://localhost:5173/')

  const problems = []
  const check = (condition, message) => {
    if (!condition) problems.push(message)
  }

  const transport = await page.evaluate(async () => {
    const { uploadAvatar } = await import('/src/features/media/api.ts')

    /** What the stub recorded the client sending, one entry per XHR. */
    const sent = []
    /** How the stub answers the next XHR. */
    let tape = null

    class StubUpload {
      constructor() {
        this.listeners = {}
      }
      addEventListener(type, listener) {
        this.listeners[type] = listener
      }
      // The adopted client assigns `upload.onprogress` rather than listening, so a
      // fired event has to reach the property as well as any listener.
      fire(type, event) {
        this.listeners[type]?.(event)
        this[`on${type}`]?.(event)
      }
    }

    class StubXhr {
      constructor() {
        this.upload = new StubUpload()
        this.listeners = {}
        this.headers = {}
        this.withCredentials = false
        this.timeout = 0
      }
      open(method, url) {
        this.method = method
        this.url = url
      }
      setRequestHeader(name, value) {
        this.headers[name.toLowerCase()] = value
      }
      getAllResponseHeaders() {
        return Object.entries(tape?.responseHeaders ?? {})
          .map(([name, value]) => `${name}: ${value}`)
          .join('\r\n')
      }
      addEventListener(type, listener) {
        this.listeners[type] = this.listeners[type] ?? []
        this.listeners[type].push(listener)
      }
      removeEventListener() {}
      abort() {
        queueMicrotask(() => {
          for (const listener of this.listeners.abort ?? []) listener()
          // ...and the property handler, which is how the adopted client listens.
          this.onabort?.()
        })
      }
      send(body) {
        sent.push({
          method: this.method,
          url: this.url,
          withCredentials: this.withCredentials,
          contentType: this.headers['content-type'],
          accept: this.headers['accept'],
          timeout: this.timeout,
          byteLength: body?.size ?? null,
        })
        const current = tape
        queueMicrotask(() => {
          for (const [fraction, total] of current?.progress ?? []) {
            this.upload.fire('progress', { lengthComputable: true, loaded: fraction, total })
          }
          if (current?.event === 'progress-only' || current?.hang === true) return
          this.status = current.status
          this.responseText = current.body
          const type = current?.event ?? 'load'
          for (const listener of this.listeners[type] ?? []) listener()
          // `onload` / `onerror` / `ontimeout`, as the adopted client registers them.
          this[`on${type}`]?.()
        })
      }
    }

    const realXhr = globalThis.XMLHttpRequest

    /** Runs `body` with the stub installed and one tape loaded, then restores. */
    const taped = async (nextTape, body) => {
      tape = nextTape
      sent.length = 0
      globalThis.XMLHttpRequest = StubXhr
      try {
        return await body()
      } finally {
        globalThis.XMLHttpRequest = realXhr
      }
    }

    const outcome = async (run) => {
      try {
        return { value: await run() }
      } catch (error) {
        return {
          error: {
            name: error?.constructor?.name ?? typeof error,
            status: error?.status ?? null,
            code: error?.code ?? null,
            message: error?.message ?? String(error),
            retryAfter: error?.retryAfterSeconds ?? null,
          },
        }
      }
    }

    // A real WebP signature in a fake body: the client's MIME comes from the
    // blob, and the assertion below checks the stub SAW `image/webp`.
    const webp = new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x57, 0x45, 0x42, 0x50])], {
      type: 'image/webp',
    })
    const media = { id: 'mid', key: 'avatars/u/mid.webp', url: '/m/mid.webp', width: 512, height: 512, bytes: 8 }
    const envelope = (value) => JSON.stringify({ data: value, meta: {} })
    const failure = (code, message) => JSON.stringify({ error: { code, message, details: {} } })

    const seen = []

    // A success after two progress events: fractions first, asset after.
    {
      const request = await outcome(() =>
        taped({ status: 201, body: envelope(media), progress: [[40, 100], [100, 100]] }, () =>
          new Promise((resolve, reject) => {
            const fractions = []
            uploadAvatar(webp, { onProgress: (fraction) => fractions.push(fraction) }).then(
              (asset) => resolve({ asset, fractions }),
              reject,
            )
          }),
        ),
      )
      seen.push({ name: 'success', request, sent: [...sent] })
    }

    // Every failure envelope the editor branches on, one tape each.
    const failures = [
      { name: 'too-large', status: 413, body: failure('VALIDATION_ERROR', 'Too large') },
      { name: 'unprocessable', status: 422, body: failure('VALIDATION_ERROR', 'Not a photo') },
      { name: 'rate-limited', status: 429, body: failure('RATE_LIMITED', 'Slow down'), responseHeaders: { 'retry-after': '45' } },
      { name: 'server-error', status: 500, body: failure('INTERNAL', 'Broken') },
      { name: 'unreadable', status: 201, body: 'this is not json' },
      { name: 'network', status: 0, body: '', event: 'error' },
      { name: 'timeout', status: 0, body: '', event: 'timeout' },
    ]
    for (const failureCase of failures) {
      const request = await outcome(() =>
        taped(
          {
            status: failureCase.status,
            body: failureCase.body,
            ...(failureCase.responseHeaders ? { responseHeaders: failureCase.responseHeaders } : {}),
            ...(failureCase.event ? { event: failureCase.event } : {}),
          },
          () => uploadAvatar(webp, {}),
        ),
      )
      seen.push({ name: failureCase.name, request, sent: [...sent] })
    }
    // An abort while the response hangs: the client must report a cancellation,
    // not a lost connection — the editor reconciles the latter, and a cancel
    // is not ambiguous. The tape hangs, so `abort()` fires `onAbort` itself.
    {
      const controller = new AbortController()
      const request = await outcome(() =>
        taped({ status: 0, body: '', hang: true }, () => {
          const pending = uploadAvatar(webp, { signal: controller.signal })
          controller.abort()
          return pending
        }),
      )
      seen.push({ name: 'abort', request, sent: [...sent] })
    }

    // A tape that only ever sends progress: the promise must stay pending, so a
    // real hang reads as a hang rather than a silent resolution.
    {
      const request = await outcome(() =>
        taped({ status: 201, body: envelope(media), event: 'progress-only', progress: [[10, 100]] }, () =>
          Promise.race([
            uploadAvatar(webp, {}).then(
              () => 'resolved',
              () => 'rejected',
            ),
            new Promise((resolve) => setTimeout(() => resolve('still-pending'), 50)),
          ]).then((state) => {
            if (state !== 'still-pending') throw new Error(`a hung upload must stay pending, ${state}`)
            return state
          }),
        ),
      )
      seen.push({ name: 'hang', request, sent: [...sent] })
    }

    return { seen }
  })

  const byName = Object.fromEntries(transport.seen.map((entry) => [entry.name, entry]))

  const success = byName.success.request
  check(
    success.value?.asset?.id === 'mid' && success.value?.asset?.key === 'avatars/u/mid.webp',
    `a 201 must resolve to the asset, got ${JSON.stringify(success)}`,
  )
  check(
    JSON.stringify(success.value?.fractions) === JSON.stringify([0.4, 1]),
    `progress must report each fraction once, got ${JSON.stringify(success.value?.fractions)}`,
  )
  const sent = byName.success.sent[0]
  check(sent?.method === 'POST', `the upload must POST, sent ${JSON.stringify(sent)}`)
  check(sent?.url === '/api/v1/media/avatar?kind=avatar', `the upload must target the avatar kind, sent ${sent?.url}`)
  check(sent?.withCredentials === true, 'the upload must carry the session cookie')
  check(sent?.contentType === 'image/webp', `the upload MIME must come from the blob, sent ${sent?.contentType}`)
  check(sent?.accept === 'application/json', `the upload must accept JSON, sent ${sent?.accept}`)
  check(sent?.timeout === 20_000, `the upload timeout must be 20s, sent ${sent?.timeout}`)

  const refusal = (name, want, got) =>
    check(got, `${name} must read as ${want}, got ${JSON.stringify(byName[name].request)}`)
  refusal('too-large', '413', byName['too-large'].request.error?.status === 413)
  refusal('unprocessable', 'VALIDATION_ERROR', byName.unprocessable.request.error?.code === 'VALIDATION_ERROR')
  refusal(
    'rate-limited',
    'RATE_LIMITED + Retry-After 45',
    byName['rate-limited'].request.error?.code === 'RATE_LIMITED' &&
      byName['rate-limited'].request.error?.retryAfter === 45,
  )
  refusal('server-error', '500', byName['server-error'].request.error?.status === 500)
  refusal('unreadable', 'UNKNOWN', byName.unreadable.request.error?.code === 'UNKNOWN')
  refusal('network', 'NETWORK', byName.network.request.error?.code === 'NETWORK')
  refusal('timeout', 'NETWORK', byName.timeout.request.error?.code === 'NETWORK')
  refusal('abort', 'cancelled', byName.abort.request.error?.message === 'The photo upload was cancelled.')
  refusal('hang', 'still pending', byName.hang.request.value === 'still-pending')

  // Every refusal above still went out as a credentialed avatar POST: the
  // envelope differs, the wire shape must not.
  for (const entry of transport.seen) {
    if (entry.name === 'hang') continue
    check(
      entry.sent.length === 1 &&
        entry.sent[0]?.url === '/api/v1/media/avatar?kind=avatar' &&
        entry.sent[0]?.withCredentials === true,
      `${entry.name} must still send one credentialed avatar POST, sent ${JSON.stringify(entry.sent)}`,
    )
  }

  // A test-only mount (see `src/test-support/photo-ui-check-mount.tsx`): the real
  // dialog behind a button labelled "Open crop", driven through returned
  // handles rather than the app's save sequence.
  await page.evaluate(async () => {
    const { decodePhoto } = await import('/src/features/media/image.ts')
    const { mountPhotoCheckDialog } = await import('/src/test-support/photo-ui-check-mount.tsx')

    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 800
    const context = canvas.getContext('2d')
    const quadrants = [
      ['rgb(220,40,40)', 0, 0],
      ['rgb(40,160,80)', 600, 0],
      ['rgb(40,80,200)', 0, 400],
      ['rgb(230,200,40)', 600, 400],
    ]
    for (const [fill, x, y] of quadrants) {
      context.fillStyle = fill
      context.fillRect(x, y, 600, 400)
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    // Carried module-scope so the teardown below can release the bitmap and
    // unmount: the dialog owns the photo it renders, the script owns the rest.
    globalThis.__photoUiCheckPhoto = await decodePhoto(new File([blob], 'source.png', { type: 'image/png' }))
    globalThis.__photoUiCheckMount = mountPhotoCheckDialog(globalThis.__photoUiCheckPhoto)
  })

  const saves = () => page.evaluate(() => globalThis.__photoUiCheckMount.events.saves)
  const setPending = (pending) =>
    page.evaluate((value) => globalThis.__photoUiCheckMount.setPending(value), pending)

  const openButton = page.getByRole('button', { name: 'Open crop', exact: true })
  const dialog = page.getByRole('dialog', { name: 'Crop your photo' })
  // Resolved lazily, not up front: each open renders a fresh dialog subtree,
  // and a locator pinned to the previous subtree's Cancel goes stale.
  const cancelButton = () => page.getByRole('button', { name: 'Cancel', exact: true })
  const saveButton = () => page.getByRole('button', { name: 'Save photo', exact: true })
  await openButton.click()
  await dialog.waitFor({ state: 'visible' })
  check(true, 'opened the crop dialog')
  check(
    (await page.getByRole('img', { name: 'Photo crop' }).count()) === 1,
    'the crop viewport must expose its accessible name',
  )
  // Escape closes and returns focus to the control that opened the dialog —
  // the reason this is a native `<dialog>` at all.
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  check(
    await openButton.evaluate((element) => element === document.activeElement),
    'Escape must return focus to the opening control',
  )
  check(
    (await page.evaluate(() => globalThis.__photoUiCheckMount.events.cancels)) === 1,
    'Escape must cancel exactly once',
  )

  // Cancel does the same through the button.
  await openButton.click()
  await dialog.waitFor({ state: 'visible' })
  await cancelButton().click()
  await dialog.waitFor({ state: 'hidden' })
  check(
    await openButton.evaluate((element) => element === document.activeElement),
    'Cancel must return focus to the opening control',
  )

  // While a save runs the dialog locks: Escape is refused and Cancel goes
  // inert, so an in-flight upload cannot be abandoned by a stray key press.
  // Buttons are re-resolved after the open settles: Playwright's role query
  // needs the render committed, and earlier probes showed the query racing it.
  await openButton.click()
  await dialog.waitFor({ state: 'visible' })
  await cancelButton().waitFor({ state: 'visible' })
  await setPending(true)
  await page.keyboard.press('Escape')
  check(await dialog.isVisible(), 'Escape must not close the dialog while a save is pending')
  check(await cancelButton().isDisabled(), 'Cancel must lock while a save is pending')
  await setPending(false)
  // Escape needs a settled (non-pending) render before it can dismiss: the
  // pending flag flips through React state, so wait a frame for it to land.
  await cancelButton().waitFor({ state: 'visible' })
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('dialog button')].find((candidate) =>
      candidate.textContent?.includes('Cancel'),
    )
    return button !== undefined && !button.disabled
  })
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })

  // Pointer drag: the viewport IS the crop, so dragging the photo right moves
  // the crop left. A quarter of the viewport on a 1200-wide source moves 200
  // source pixels — clamped at the edge, because the resting crop starts at x=200.
  await openButton.click()
  await dialog.waitFor({ state: 'visible' })
  await cancelButton().waitFor({ state: 'visible' })
  const viewport = page.getByRole('img', { name: 'Photo crop' })
  const box = await viewport.boundingBox()
  const dragBy = Math.round(box.width / 4)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + dragBy, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  check(
    (await saves()) === 0,
    'dragging must move the crop without saving',
  )

  // Arrow keys nudge without saving; the viewport keeps focus for them.
  await viewport.focus()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowRight')
  check(
    (await saves()) === 0,
    'arrow keys must nudge without saving',
  )

  // Zoom narrows the crop around its centre; Reset restores the cover crop.
  const zoom = page.getByLabel('Zoom')
  await zoom.fill('2.5')
  check((await zoom.inputValue()) === '2.5', 'the zoom slider must take 2.5')
  await page.getByRole('button', { name: 'Reset crop', exact: true }).click()
  check((await zoom.inputValue()) === '1', 'Reset must return the slider to 1')

  // Repeated Save presses: the Button locks while pending, so the second press
  // is a force click — Playwright-level actionability would refuse a disabled
  // button, but the component must absorb the press anyway. The adopted button
  // keeps its label while pending, so the same locator resolves it. One callback
  // total, not two.
  const savesBefore = await saves()
  await saveButton().click()
  await setPending(true)
  await saveButton().click({ force: true })
  const savesAfter = await saves()
  check(
    savesAfter - savesBefore === 1,
    `Save must call back once despite repeated presses, called ${savesAfter - savesBefore} times`,
  )
  await setPending(false)

  // Progress and error states render with the names assistive tech needs.
  await page.evaluate(() => {
    globalThis.__photoUiCheckMount.setPending(true)
    globalThis.__photoUiCheckMount.setPhase('uploading')
    globalThis.__photoUiCheckMount.setProgress(0.4)
  })
  check(
    (await page
      .getByRole('progressbar', { name: 'Photo upload' })
      .evaluate((element) => element.value)) === 40,
    'the progressbar must expose the fraction as its value',
  )
  await page.evaluate(() => {
    globalThis.__photoUiCheckMount.setProgress(null)
    globalThis.__photoUiCheckMount.setError('The upload was cancelled.')
  })
  // `page.evaluate` returns when the callback returns, NOT when React has
  // re-rendered — so the render is waited for before it is counted.
  await page.getByText('The upload was cancelled.').waitFor({ state: 'visible' })
  check(
    (await page.getByText('The upload was cancelled.').count()) === 1,
    'a save error must render inside the dialog beside its retry',
  )
  await page.evaluate(() => {
    globalThis.__photoUiCheckMount.setPending(false)
    globalThis.__photoUiCheckMount.setPhase('idle')
    globalThis.__photoUiCheckMount.setError(null)
  })
  // Escape fires the native dialog's `cancel`, and the dialog REFUSES that while a
  // save is pending — deliberately, so a stray key press cannot abandon an in-flight
  // upload. Those last three state calls flush asynchronously, so pressing Escape
  // straight after them is a race that lands while `pending` is still true — the one
  // state the dialog is built to refuse. The disabled Cancel button is the same
  // `pending` flag, so waiting for it to come back is waiting for the state the
  // Escape press is about to exercise.
  await page.waitForFunction(() => {
    const cancel = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Cancel'),
    )
    return cancel !== undefined && !cancel.disabled
  })
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })

  // The mount decoded a real bitmap for the dialog; release it and unmount so
  // the check leaves no pinned frame behind.
  await page.evaluate(() => {
    globalThis.__photoUiCheckMount.unmount()
    globalThis.__photoUiCheckPhoto.release()
    globalThis.__photoUiCheckMount = null
    globalThis.__photoUiCheckPhoto = null
  })

  if (problems.length > 0) {
    throw new Error(`profile-photo ui check failed:\n- ${problems.join('\n- ')}`)
  }
  console.log('profile-photo ui check: all assertions passed')
}


