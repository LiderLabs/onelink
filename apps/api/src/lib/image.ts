// ============================================================================
// Image bytes, read without decoding them (R1.3).
//
// One job: decide what an upload actually is, and how large its pixels claim to be.
// **D4** puts the crop and the re-encode in the browser, so this API stores exactly
// the bytes it was given — it never manipulates an image, which means it can never
// learn about one by having handled it. It has to look.
//
// No decoder and no dependency: all four accepted formats carry their dimensions in
// a header a few byte reads can reach, so there is no reason to allocate a canvas
// (or ship an image library into the Worker bundle) to learn what the file already
// says about itself.
//
// A header this module cannot read is a REFUSAL, not a fallback. An upload whose
// dimensions are unknown cannot be checked against `MAX_MEDIA_DIMENSION`, and "trust
// it, because we could not look" is the wrong way round for the one input every
// visitor's browser will decode.
// ============================================================================

export const IMAGE_MIME_TYPES = ['image/webp', 'image/png', 'image/jpeg', 'image/gif'] as const
export type ImageMime = (typeof IMAGE_MIME_TYPES)[number]

/**
 * Declared types that mean one of the four above.
 *
 * `image/jpg` is the one client bug worth absorbing: it is what a hand-written
 * `Content-Type` says for a JPEG, and refusing it would refuse a correct upload. The
 * list is deliberately short — anything not here and not in `IMAGE_MIME_TYPES` is a
 * claim about a format this API does not store.
 */
const MIME_ALIASES: Record<string, ImageMime> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
}

/** The extension each format is stored under — also what `lib/media.ts` allows in a key. */
const FILE_EXTENSIONS: Record<ImageMime, string> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
}

export function extensionForMime(mime: ImageMime): string {
  return FILE_EXTENSIONS[mime]
}

export interface SniffedImage {
  mime: ImageMime
  width: number
  height: number
}

/**
 * True when a `Content-Type` makes no claim about the format — absent,
 * `application/octet-stream`, or whitespace.
 *
 * These are the only headers the sniff alone is allowed to decide. Anything else
 * either names one of the four formats (and is checked against the bytes) or names
 * something that is not an image at all (which the route refuses).
 */
export function isGenericContentType(header: string | null | undefined): boolean {
  if (!header) return true
  const value = header.split(';')[0]?.trim().toLowerCase() ?? ''
  return value === '' || value === 'application/octet-stream' || value === 'binary/octet-stream'
}

/** The format a declared `Content-Type` names, or `null` when it names none of the four. */
export function declaredImageMime(header: string | null | undefined): ImageMime | null {
  if (!header) return null
  const value = header.split(';')[0]?.trim().toLowerCase() ?? ''
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(value)) return value as ImageMime
  return MIME_ALIASES[value] ?? null
}

// ------------------------------------------------------------- byte readers --
//
// Every reader re-checks its own signature, so the order they are tried in below
// cannot misattribute one format to another. The `?? 0` fallbacks are unreachable
// under the length check that guards each read — they exist because
// `noUncheckedIndexedAccess` is on, not because a short file is tolerated.

interface Dimensions {
  width: number
  height: number
}

const u16be = (b: Uint8Array, o: number): number => ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0)
const u16le = (b: Uint8Array, o: number): number => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8)
const u24le = (b: Uint8Array, o: number): number =>
  (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16)
const u32be = (b: Uint8Array, o: number): number =>
  (((b[o] ?? 0) << 24) | ((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0)) >>> 0

function matches(b: Uint8Array, offset: number, signature: readonly number[]): boolean {
  for (let i = 0; i < signature.length; i += 1) {
    if (b[offset + i] !== signature[i]) return false
  }
  return true
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
/** `IHDR` — a PNG's first chunk, and the only one that states the dimensions. */
const PNG_IHDR = [0x49, 0x48, 0x44, 0x52] as const

function pngSize(b: Uint8Array): Dimensions | null {
  // 8 signature + 4 chunk length + 4 chunk type, then width and height at 16 and 20.
  if (b.length < 24 || !matches(b, 0, PNG_SIGNATURE) || !matches(b, 12, PNG_IHDR)) return null
  return { width: u32be(b, 16), height: u32be(b, 20) }
}

function gifSize(b: Uint8Array): Dimensions | null {
  // "GIF87a" or "GIF89a", then the logical screen descriptor at offset 6.
  if (b.length < 10 || !matches(b, 0, [0x47, 0x49, 0x46, 0x38])) return null
  if ((b[4] !== 0x37 && b[4] !== 0x39) || b[5] !== 0x61) return null
  return { width: u16le(b, 6), height: u16le(b, 8) }
}

function webpSize(b: Uint8Array): Dimensions | null {
  if (b.length < 30 || !matches(b, 0, [0x52, 0x49, 0x46, 0x46])) return null
  if (!matches(b, 8, [0x57, 0x45, 0x42, 0x50])) return null

  const chunk = String.fromCharCode(b[12] ?? 0, b[13] ?? 0, b[14] ?? 0, b[15] ?? 0)

  // Extended format: the canvas size is stated in the header itself. This is what a
  // browser produces for anything with alpha — i.e. for a cropped avatar.
  if (chunk === 'VP8X') return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 }

  // Lossless: 0x2f signature, then 14 bits of width-1 and 14 bits of height-1.
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null
    const packed = u32be(b, 21)
    return { width: (packed & 0x3fff) + 1, height: ((packed >> 14) & 0x3fff) + 1 }
  }

  // Lossy: a VP8 key frame — 3-byte frame tag, the 0x9d012a start code, then two
  // 16-bit little-endian values whose low 14 bits are the dimensions.
  if (chunk === 'VP8 ') {
    if (!matches(b, 23, [0x9d, 0x01, 0x2a])) return null
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }
  }

  return null
}

/** `SOF` markers that carry a frame's dimensions, including the progressive variants. */
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

/**
 * Walks JPEG segments to the frame header.
 *
 * The only format here without a fixed offset: everything before the frame is a
 * variable-length segment, so the marker chain has to be followed. A file that runs
 * out of segments, desynchronises, or reaches the scan data without a frame header is
 * refused rather than guessed at. An EXIF thumbnail carries a second frame header
 * later in the file; the first one is the full-size image, which is the one that
 * matters, and the loop stops there.
 */
function jpegSize(b: Uint8Array): Dimensions | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null

  let offset = 2
  while (offset < b.length) {
    if (b[offset] !== 0xff) return null
    // 0xff may be repeated as padding before the marker byte.
    while (b[offset] === 0xff) offset += 1

    const marker = b[offset]
    offset += 1
    if (marker === undefined) return null
    // End of image or start of scan: every header is behind us and none had a frame.
    if (marker === 0xd9 || marker === 0xda) return null
    // Standalone markers carry no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > b.length) return null

    const length = u16be(b, offset)
    if (length < 2) return null

    if (JPEG_SOF_MARKERS.has(marker)) {
      // [length 2][precision 1][height 2][width 2]…
      if (offset + 7 > b.length) return null
      return { width: u16be(b, offset + 5), height: u16be(b, offset + 3) }
    }

    offset += length
  }

  return null
}

// ------------------------------------------------------------------ sniffing --

/**
 * What these bytes are and how big they say they are — or `null` when they are not an
 * image this API accepts.
 *
 * Signature first, dimensions in the same pass: a file is never described by its
 * extension, its declared type or its filename, only by what it starts with, and a
 * format that passes the signature check but cannot state its size is corrupt enough
 * to refuse before it is ever stored.
 */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  const png = pngSize(bytes)
  if (png) return { mime: 'image/png', ...png }

  const gif = gifSize(bytes)
  if (gif) return { mime: 'image/gif', ...gif }

  const webp = webpSize(bytes)
  if (webp) return { mime: 'image/webp', ...webp }

  const jpeg = jpegSize(bytes)
  if (jpeg) return { mime: 'image/jpeg', ...jpeg }

  return null
}
