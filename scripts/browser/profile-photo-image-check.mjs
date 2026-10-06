// Browser check for the pure photo helpers (R1.3 / D4), Task 4.
//
//   node scripts/browser/run-check.mjs scripts/browser/profile-photo-image-check.mjs
//
// Runs against the Vite dev origin (`npm.cmd run dev:web`, with the API up) so the
// `import('/src/...')` calls below resolve through Vite's own transform — the same
// modules the app ships, not a copy.
//
// Everything is drawn in the page rather than read from disk: a canvas gives exact
// colours to assert on, and it keeps this check about the image pipeline instead of
// about file paths. The committed fixture is for the flow check, which has to hand
// a real file to a file input.
//
// The export cap is `MAX_AVATAR_BYTES` in `features/media/image.ts`: 240 KiB, the
// same bound the avatar route enforces, so a cropped-and-encoded photo can never be
// refused by the API after the user has already chosen their frame.
//
// The plan also asks for a committed JPEG fixture carrying EXIF orientation 6.
// There is no JPEG encoder without a dependency, so the picture is encoded by the
// browser at check time and a real APP1/Exif segment is spliced into it; an
// untagged control of the same bytes proves the rotation came from the tag.
export default async (page) => {
  await page.goto('http://localhost:5173/')

  const problems = []
  const check = (condition, message) => {
    if (!condition) problems.push(message)
  }

  const geometry = await page.evaluate(async () => {
    const { initialCrop, clampCrop, zoomCrop } = await import(
      '/src/features/media/crop.ts'
    )

    return {
      wide: initialCrop(1200, 800),
      tall: initialCrop(800, 1200),
      square: initialCrop(600, 600),
      clampedNegative: clampCrop({ x: -50, y: -20, size: 800 }, 1200, 800),
      clampedOverrun: clampCrop({ x: 900, y: 700, size: 800 }, 1200, 800),
      oversized: clampCrop({ x: 0, y: 0, size: 5000 }, 1200, 800),
      zoomedIn: zoomCrop({ x: 200, y: 0, size: 800 }, 2, 1200, 800),
      zoomedOutOfRange: zoomCrop({ x: 200, y: 0, size: 800 }, 99, 1200, 800),
      zoomedBelowRange: zoomCrop({ x: 200, y: 0, size: 800 }, 0.1, 1200, 800),
    }
  })

  // A wide source crops the largest centred square: 800 wide, 200 in from each side.
  check(
    geometry.wide.x === 200 && geometry.wide.y === 0 && geometry.wide.size === 800,
    `wide initialCrop was ${JSON.stringify(geometry.wide)}, expected {x:200,y:0,size:800}`,
  )
  check(
    geometry.tall.x === 0 && geometry.tall.y === 200 && geometry.tall.size === 800,
    `tall initialCrop was ${JSON.stringify(geometry.tall)}, expected {x:0,y:200,size:800}`,
  )
  check(
    geometry.square.size === 600 && geometry.square.x === 0 && geometry.square.y === 0,
    `square initialCrop was ${JSON.stringify(geometry.square)}`,
  )

  check(
    geometry.clampedNegative.x === 0 && geometry.clampedNegative.y === 0,
    `a crop dragged past the top-left must clamp to 0,0 (got ${JSON.stringify(geometry.clampedNegative)})`,
  )
  check(
    geometry.clampedOverrun.x === 400 && geometry.clampedOverrun.y === 0,
    `a crop past the bottom-right must clamp to 400,0 (got ${JSON.stringify(geometry.clampedOverrun)})`,
  )
  check(
    geometry.oversized.size === 800,
    `a crop taller than the source must shrink to 800 (got ${geometry.oversized.size})`,
  )
  // Zoom preserves the centre: (600, 400) stays (600, 400) at half the size.
  check(
    geometry.zoomedIn.size === 400 && geometry.zoomedIn.x === 400 && geometry.zoomedIn.y === 200,
    `zooming to 2x must keep the centre (got ${JSON.stringify(geometry.zoomedIn)})`,
  )
  check(
    geometry.zoomedOutOfRange.size === 200,
    `zoom must clamp at 4 (got size ${geometry.zoomedOutOfRange.size})`,
  )
  check(
    geometry.zoomedBelowRange.size === 800,
    `zoom must clamp at 1 (got size ${geometry.zoomedBelowRange.size})`,
  )
  const pipeline = await page.evaluate(async () => {
    const { decodePhoto, encodeAvatar } = await import(
      '/src/features/media/image.ts'
    )
    const { initialCrop } = await import('/src/features/media/crop.ts')

    const COLORS = {
      topLeft: [220, 40, 40],
      topRight: [40, 160, 80],
      bottomLeft: [40, 80, 200],
      bottomRight: [230, 200, 40],
    }

    /** A source with four distinct quadrants, drawn in the page. */
    const draw = (width, height) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      const halfX = width / 2
      const halfY = height / 2
      const paint = (color, x, y) => {
        context.fillStyle = `rgb(${color.join(',')})`
        context.fillRect(x, y, halfX, halfY)
      }
      paint(COLORS.topLeft, 0, 0)
      paint(COLORS.topRight, halfX, 0)
      paint(COLORS.bottomLeft, 0, halfY)
      paint(COLORS.bottomRight, halfX, halfY)
      return canvas
    }

    const fileFrom = async (canvas, name = 'source.png', type = 'image/png') => {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, type))
      return new File([blob], name, { type })
    }

    /** The four corners of a blob, plus its dimensions and first 12 bytes. */
    const inspect = async (blob) => {
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d')
      context.drawImage(bitmap, 0, 0)
      const at = (x, y) => Array.from(context.getImageData(x, y, 1, 1).data).slice(0, 3)
      const report = {
        width: bitmap.width,
        height: bitmap.height,
        topLeft: at(4, 4),
        topRight: at(bitmap.width - 5, 4),
        bottomLeft: at(4, bitmap.height - 5),
        bottomRight: at(bitmap.width - 5, bitmap.height - 5),
        signature: Array.from(new Uint8Array(await blob.slice(0, 12).arrayBuffer())),
      }
      bitmap.close()
      return report
    }

    /** The refusal message for a file that must not be accepted, or null. */
    const refusal = async (run) => {
      try {
        await run()
        return null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }

    const photo = await decodePhoto(await fileFrom(draw(1200, 800)))
    const dimensions = { width: photo.width, height: photo.height }
    const encoded = await encodeAvatar(photo, initialCrop(photo.width, photo.height))
    const exported = await inspect(encoded)
    photo.release()

    // An extended WebP whose VP8X ANIM flag (byte 20, 0x02) is set, carrying the
    // 10-byte VP8X payload the container requires. Refusing this from the header is
    // the only way to catch an animation the API cannot see: what would reach it is
    // one still frame, which the browser decodes happily.
    const animated = new Uint8Array(30)
    animated.set([0x52, 0x49, 0x46, 0x46], 0)
    animated.set([0x57, 0x45, 0x42, 0x50], 8)
    animated.set([0x56, 0x50, 0x38, 0x58], 12)
    animated.set([10, 0, 0, 0], 16)
    animated[20] = 0x02

    return {
      dimensions,
      encodedBytes: encoded.size,
      encodedType: encoded.type,
      exported,
      refusals: {
        empty: await refusal(() => decodePhoto(new File([], 'empty.png', { type: 'image/png' }))),
        gif: await refusal(
          () => decodePhoto(new File([new Uint8Array(8)], 'a.gif', { type: 'image/gif' })),
        ),
        svg: await refusal(
          () => decodePhoto(new File([new Uint8Array(8)], 'a.svg', { type: 'image/svg+xml' })),
        ),
        text: await refusal(
          () => decodePhoto(new File([new Uint8Array(9)], 'a.png', { type: 'image/png' })),
        ),
        animatedWebp: await refusal(
          () => decodePhoto(new File([animated], 'a.webp', { type: 'image/webp' })),
        ),
        oversized: await refusal(() =>
          decodePhoto(
            new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }),
          ),
        ),
      },
    }
  })

  check(
    pipeline.dimensions.width === 1200 && pipeline.dimensions.height === 800,
    `decoded source was ${JSON.stringify(pipeline.dimensions)}, expected 1200x800`,
  )
  check(
    pipeline.exported.width === 512 && pipeline.exported.height === 512,
    `export was ${pipeline.exported.width}x${pipeline.exported.height}, expected 512x512`,
  )
  check(pipeline.encodedType === 'image/webp', `export MIME was ${pipeline.encodedType}`)
  check(
    pipeline.exported.signature[0] === 0x52 && pipeline.exported.signature[8] === 0x57,
    `export lacks the RIFF/WEBP signature: ${pipeline.exported.signature.join(',')}`,
  )
  check(
    pipeline.encodedBytes <= 240 * 1024,
    `export was ${pipeline.encodedBytes} bytes, over the 240 KiB the API accepts`,
  )

  // The centred square of a wide source contains all four quadrants, each in its own
  // corner: what the dialog framed is what the encoder wrote, and a rotated or
  // mis-scaled frame would fail here.
  const expectedCorners = {
    topLeft: [220, 40, 40],
    topRight: [40, 160, 80],
    bottomLeft: [40, 80, 200],
    bottomRight: [230, 200, 40],
  }
  for (const [corner, expected] of Object.entries(expectedCorners)) {
    const actual = pipeline.exported[corner]
    const close = actual.every((value, index) => Math.abs(value - expected[index]) <= 12)
    check(close, `exported ${corner} was ${actual.join(',')}, expected about ${expected.join(',')}`)
  }

  const { refusals } = pipeline
  check(refusals.empty !== null, 'an empty file must be refused')
  check(
    refusals.gif !== null && /JPEG, PNG, or WebP/.test(refusals.gif),
    `a GIF must be refused as an unsupported format (got ${refusals.gif})`,
  )
  check(refusals.svg !== null, 'an SVG must be refused')
  check(refusals.text !== null, 'bytes that are not an image must be refused')
  check(
    refusals.animatedWebp !== null && /Animated/.test(refusals.animatedWebp),
    `an animated WebP must be refused from its header (got ${refusals.animatedWebp})`,
  )
  check(
    refusals.oversized !== null && /10 MB/.test(refusals.oversized),
    `a file over 10 MB must be refused (got ${refusals.oversized})`,
  )
  const edges = await page.evaluate(async () => {
    const { decodePhoto, encodeAvatar } = await import('/src/features/media/image.ts')
    const { initialCrop } = await import('/src/features/media/crop.ts')

    /** The refusal message for something that must not be accepted, or null. */
    const refusal = async (run) => {
      try {
        await run()
        return null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }

    /** Runs `body` with one global replaced, restoring it however `body` ends. */
    const withStub = async (key, replace, body) => {
      const original = globalThis[key]
      globalThis[key] = replace(original)
      try {
        return await body()
      } finally {
        globalThis[key] = original
      }
    }

    const withCanvasStub = async (replace, body) => {
      const original = HTMLCanvasElement.prototype.toBlob
      HTMLCanvasElement.prototype.toBlob = replace(original)
      try {
        return await body()
      } finally {
        HTMLCanvasElement.prototype.toBlob = original
      }
    }

    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 240
    const context = canvas.getContext('2d')
    context.fillStyle = 'rgb(220, 40, 40)'
    context.fillRect(0, 0, 320, 240)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    const sourceFile = () => new File([blob], 'source.png', { type: 'image/png' })

    // Dimensions the browser would never agree to are exactly why these two cases use
    // a stubbed decode: a 40-megapixel photo is 160 MB of decoded frame, and the
    // point of the limit is that the browser never gets that far in the first place.
    const tooManyPixels = await withStub(
      'createImageBitmap',
      () => async () => ({ width: 9000, height: 5000, close() {} }),
      () => refusal(() => decodePhoto(sourceFile())),
    )
    const noSize = await withStub(
      'createImageBitmap',
      () => async () => ({ width: 0, height: 0, close() {} }),
      () => refusal(() => decodePhoto(sourceFile())),
    )

    const realPhoto = await decodePhoto(sourceFile())
    const crop = initialCrop(realPhoto.width, realPhoto.height)

    // A browser without a WebP encoder hands back a PNG from `toBlob` rather than
    // failing, and `spec` is the only place that lie can be caught.
    const encoderMissing = await withCanvasStub(
      (original) =>
        function (callback, _type, quality) {
          return original.call(this, callback, 'image/png', quality)
        },
      () => refusal(() => encodeAvatar(realPhoto, crop)),
    )

    // A photo that stays over the cap at every quality: the loop has to give up and
    // say so, rather than uploading bytes the API will refuse.
    const tooLarge = await withCanvasStub(
      () =>
        function (callback) {
          const bytes = new Uint8Array(241 * 1024)
          bytes.set([0x52, 0x49, 0x46, 0x46], 0)
          bytes.set([0x57, 0x45, 0x42, 0x50], 8)
          bytes.set([0x56, 0x50, 0x38, 0x4c], 12)
          callback(new Blob([bytes], { type: 'image/webp' }))
        },
      () => refusal(() => encodeAvatar(realPhoto, crop)),
    )
    realPhoto.release()

    return {
      // A valid PNG signature followed by garbage: the sniffer lets it through,
      // but the bytes will never decode, so the failure must name a damaged image
      // rather than an unknown format — the two refusals mean different things to
      // a user choosing what to try next.
      corrupt: await refusal(() => {
        const damaged = new Uint8Array(64)
        damaged.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
        return decodePhoto(new File([damaged], 'a.png', { type: 'image/png' }))
      }),
      video: await refusal(
        () => decodePhoto(new File([new Uint8Array(64)], 'a.mp4', { type: 'video/mp4' })),
      ),
      tooManyPixels,
      noSize,
      encoderMissing,
      tooLarge,
    }
  })

  check(
    edges.corrupt !== null && /Try a different image/.test(edges.corrupt),
    `bytes that will not decode must be refused as unreadable (got ${edges.corrupt})`,
  )
  check(
    edges.video !== null && /JPEG, PNG, or WebP/.test(edges.video),
    `a video must be refused as an unsupported format (got ${edges.video})`,
  )
  check(
    edges.tooManyPixels !== null && /40 million pixels/.test(edges.tooManyPixels),
    `an image over 40 megapixels must be refused (got ${edges.tooManyPixels})`,
  )
  // A zero-sized decode takes the same guard as the pixel cap in the adopted
  // implementation (`!width || !height || too many pixels`), so its wording is that
  // limit's message rather than one of its own.
  check(edges.noSize !== null, `a zero-sized image must be refused (got ${edges.noSize})`)
  check(
    edges.encoderMissing !== null && /newer browser/.test(edges.encoderMissing),
    `an encoder that is not WebP must be refused, not mislabelled (got ${edges.encoderMissing})`,
  )
  check(
    edges.tooLarge !== null && /240 KiB/.test(edges.tooLarge),
    `an export over the cap at every quality must be refused (got ${edges.tooLarge})`,
  )

  // Orientation, with a real EXIF JPEG. There is no JPEG encoder in Node, so the
  // fixture is made here: the browser encodes a quadrant image, and an APP1/Exif
  // segment carrying orientation 6 is spliced in after the SOI marker. The picture
  // is a genuine JPEG either way — what changes is the tag.
  const orientation = await page.evaluate(async () => {
    const { decodePhoto, encodeAvatar } = await import('/src/features/media/image.ts')
    const { initialCrop } = await import('/src/features/media/crop.ts')

    const COLORS = {
      topLeft: [220, 40, 40],
      topRight: [40, 160, 80],
      bottomLeft: [40, 80, 200],
      bottomRight: [230, 200, 40],
    }

    // Portrait, so a 90-degree rotation is visible in the dimensions alone.
    const canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 1200
    const context = canvas.getContext('2d')
    const paint = (color, x, y) => {
      context.fillStyle = `rgb(${color.join(',')})`
      context.fillRect(x, y, 400, 600)
    }
    paint(COLORS.topLeft, 0, 0)
    paint(COLORS.topRight, 400, 0)
    paint(COLORS.bottomLeft, 0, 600)
    paint(COLORS.bottomRight, 400, 600)

    const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    const stored = new Uint8Array(await jpeg.arrayBuffer())

    /** The same JPEG with an Exif APP1 segment claiming `orientation`. */
    const tag = (value) => {
      const payload = new Uint8Array([
        0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
        0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // little-endian TIFF, IFD0 at 8
        0x01, 0x00, // one entry
        0x12, 0x01, // tag 0x0112, orientation
        0x03, 0x00, // type SHORT
        0x01, 0x00, 0x00, 0x00, // count 1
        value, 0x00, 0x00, 0x00, // value
        0x00, 0x00, 0x00, 0x00, // no next IFD
      ])
      const length = payload.length + 2
      const segment = new Uint8Array(payload.length + 4)
      segment.set([0xff, 0xe1, length >> 8, length & 0xff], 0)
      segment.set(payload, 4)

      // SOI, then APP1, then the encoder's own segments.
      return new Blob([stored.slice(0, 2), segment, stored.slice(2)], { type: 'image/jpeg' })
    }

    /** Decodes a source, exports the initial crop, and reports both. */
    const exportCorners = async (blob, name) => {
      const photo = await decodePhoto(new File([blob], name, { type: 'image/jpeg' }))
      const dimensions = { width: photo.width, height: photo.height }
      const encoded = await encodeAvatar(photo, initialCrop(photo.width, photo.height))
      photo.release()

      const bitmap = await createImageBitmap(encoded)
      const target = document.createElement('canvas')
      target.width = bitmap.width
      target.height = bitmap.height
      const targetContext = target.getContext('2d')
      targetContext.drawImage(bitmap, 0, 0)
      const at = (x, y) => Array.from(targetContext.getImageData(x, y, 1, 1).data).slice(0, 3)
      const corners = {
        topLeft: at(6, 6),
        topRight: at(bitmap.width - 7, 6),
        bottomLeft: at(6, bitmap.height - 7),
        bottomRight: at(bitmap.width - 7, bitmap.height - 7),
      }
      bitmap.close()
      return { dimensions, corners }
    }

    return {
      untagged: await exportCorners(new Blob([stored], { type: 'image/jpeg' }), 'plain.jpg'),
      rotated: await exportCorners(tag(6), 'oriented.jpg'),
    }
  })

  // Without the tag the portrait source stays portrait, so the control proves the
  // rotation below came from the EXIF orientation and not from the JPEG encoder.
  check(
    orientation.untagged.dimensions.width === 800 && orientation.untagged.dimensions.height === 1200,
    `an untagged JPEG decoded to ${JSON.stringify(orientation.untagged.dimensions)}, expected 800x1200`,
  )
  check(
    orientation.rotated.dimensions.width === 1200 && orientation.rotated.dimensions.height === 800,
    `an orientation-6 JPEG decoded to ${JSON.stringify(orientation.rotated.dimensions)}, expected the swapped 1200x800`,
  )

  const colourName = (rgb) => {
    const entries = [
      ['red', [220, 40, 40]],
      ['green', [40, 160, 80]],
      ['blue', [40, 80, 200]],
      ['yellow', [230, 200, 40]],
    ]
    let best = 'unknown'
    let distance = Infinity
    for (const [name, expected] of entries) {
      const value = rgb.reduce(
        (total, channel, index) => total + Math.abs(channel - expected[index]),
        0,
      )
      if (value < distance) {
        distance = value
        best = name
      }
    }
    return distance <= 60 ? best : `unknown(${rgb.join(',')})`
  }

  // A quarter turn clockwise sends the source's bottom-left to the top-left.
  const expected = {
    untagged: { topLeft: 'red', topRight: 'green', bottomLeft: 'blue', bottomRight: 'yellow' },
    rotated: { topLeft: 'blue', topRight: 'red', bottomLeft: 'yellow', bottomRight: 'green' },
  }
  for (const variant of ['untagged', 'rotated']) {
    for (const [corner, name] of Object.entries(expected[variant])) {
      const actual = colourName(orientation[variant].corners[corner])
      check(
        actual === name,
        `the ${variant} export's ${corner} was ${actual}, expected ${name} — the preview and the export disagree about orientation`,
      )
    }
  }

  if (problems.length > 0) {
    throw new Error(`profile-photo image check failed:\n- ${problems.join('\n- ')}`)
  }
  console.log('profile-photo image check: all assertions passed')
}
