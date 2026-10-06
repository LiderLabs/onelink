import { AppError, validationError } from './errors'

export const AVATAR_SIZE = 512
export const MAX_AVATAR_BYTES = 240 * 1024
export const AVATAR_KEY_PATTERN = /^avatars\/[A-Za-z0-9_-]+\/[0-9A-HJKMNP-TV-Z]{26}\.webp$/

export function mediaUrl(key: string): string {
  if (!AVATAR_KEY_PATTERN.test(key)) throw validationError('Invalid profile photo key.')
  return `/api/v1/media/files/${key}`
}

/** Container/header validation, not a decoder. Reference: Google's WebP RIFF specification. */
export function validateAvatarWebp(bytes: Uint8Array, declaredMime: string): {
  mime: 'image/webp'; width: 512; height: 512; bytes: number
} {
  if (bytes.length > MAX_AVATAR_BYTES) throw new AppError(413, 'BAD_REQUEST', 'Profile photos must be at most 240 KiB after resizing.')
  const invalid: () => never = () => { throw validationError('Choose a valid, non-animated 512 × 512 WebP photo.') }
  if (declaredMime.toLowerCase() !== 'image/webp' || bytes.length < 20) invalid()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (offset: number): string => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  const u24 = (offset: number): number => bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
  if (tag(0) !== 'RIFF' || tag(8) !== 'WEBP' || view.getUint32(4, true) !== bytes.length - 8) invalid()
  let image: { width: number; height: number } | null = null
  let extended: { width: number; height: number; flags: number } | null = null
  let alpha = false
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) invalid()
    const name = tag(offset)
    const size = view.getUint32(offset + 4, true)
    const start = offset + 8
    const end = start + size
    const paddedEnd = end + size % 2
    if (paddedEnd > bytes.length || (size % 2 && bytes[end] !== 0)) invalid()
    if (name === 'ANIM' || name === 'ANMF') invalid()
    if (name === 'VP8X') {
      if (offset !== 12 || extended || size !== 10) invalid()
      const flags = bytes[start]!
      if ((flags & 0xc3) || u24(start + 1) !== 0) invalid()
      extended = { width: u24(start + 4) + 1, height: u24(start + 7) + 1, flags }
    } else if (name === 'VP8 ') {
      if (image || size <= 10) invalid()
      const frame = u24(start)
      if ((frame & 1) || ((frame >> 1) & 7) > 3 || !(frame & 16) || (frame >>> 5) > size - 10) invalid()
      if (bytes[start + 3] !== 0x9d || bytes[start + 4] !== 1 || bytes[start + 5] !== 0x2a) invalid()
      image = { width: view.getUint16(start + 6, true) & 0x3fff, height: view.getUint16(start + 8, true) & 0x3fff }
    } else if (name === 'VP8L') {
      if (image || alpha || size <= 5 || bytes[start] !== 0x2f) invalid()
      const header = view.getUint32(start + 1, true)
      if (header >>> 29) invalid()
      image = { width: (header & 0x3fff) + 1, height: ((header >>> 14) & 0x3fff) + 1 }
    } else if (name === 'ALPH') {
      if (!extended || !(extended.flags & 16) || image || alpha || size < 2 || (bytes[start]! & 0xc0)) invalid()
      alpha = true
    }
    offset = paddedEnd
  }
  if (!image || image.width !== AVATAR_SIZE || image.height !== AVATAR_SIZE) invalid()
  if (extended && (extended.width !== image.width || extended.height !== image.height)) invalid()
  return { mime: 'image/webp', width: AVATAR_SIZE, height: AVATAR_SIZE, bytes: bytes.length }
}
