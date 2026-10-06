// Generates the browser-check fixtures (R1.3 / D4).
//
// Run: `node scripts/browser/fixtures/make-fixtures.mjs`
//
// The fixtures are GENERATED rather than committed as opaque binaries so that what
// they contain — four distinct corner colours and a black centre square — is
// reviewable in code, and so the crop assertions have known pixel values to check
// against instead of "whatever the file happened to be".
//
// No dependency does this: a PNG is a signature, a few length-prefixed chunks, and
// a zlib stream, and Node already has zlib. A hand-written encoder keeps the repo
// free of an image library for two test images.

import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

// --------------------------------------------------------------------- PNG ----

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)

  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)

  return Buffer.concat([length, body, crc])
}

/**
 * A truecolour PNG from an RGBA-ish pixel function.
 *
 * `pixel(x, y)` returns `[r, g, b]`. Filter byte 0 (None) per scanline: the images
 * are flat blocks of colour, so deflate compresses them well without the encoder
 * having to choose a filter per row.
 */
function encodePng(width, height, pixel) {
  const raw = Buffer.alloc(height * (1 + width * 3))
  let offset = 0

  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0
    offset += 1
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y)
      raw[offset] = r
      raw[offset + 1] = g
      raw[offset + 2] = b
      offset += 3
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const CORNERS = {
  topLeft: [220, 40, 40],
  topRight: [40, 160, 80],
  bottomLeft: [40, 80, 200],
  bottomRight: [230, 200, 40],
  centre: [0, 0, 0],
}

/** Four coloured quadrants plus a black centre square, so a crop can be named. */
function quadrantPixel(width, height) {
  const centreSide = Math.round(Math.min(width, height) / 8)
  return (x, y) => {
    const inCentre =
      Math.abs(x - width / 2) <= centreSide / 2 && Math.abs(y - height / 2) <= centreSide / 2
    if (inCentre) return CORNERS.centre
    const top = y < height / 2
    const left = x < width / 2
    if (top) return left ? CORNERS.topLeft : CORNERS.topRight
    return left ? CORNERS.bottomLeft : CORNERS.bottomRight
  }
}

const FIXTURES = [
  // The wide source and its tall twin: `initialCrop` must centre a square inside
  // each, which is only distinguishable from "top-left corner" with both.
  { name: 'source-photo.png', width: 1200, height: 800 },
  { name: 'source-photo-tall.png', width: 800, height: 1200 },
]

for (const fixture of FIXTURES) {
  const bytes = encodePng(fixture.width, fixture.height, quadrantPixel(fixture.width, fixture.height))
  const path = join(here, fixture.name)
  writeFileSync(path, bytes)
  console.log(`${fixture.name}: ${fixture.width}x${fixture.height}, ${bytes.length} bytes`)
}
