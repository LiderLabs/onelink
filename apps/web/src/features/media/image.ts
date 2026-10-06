import { clampCrop } from './crop'
import type { Crop, DecodedPhoto } from './types'

export const AVATAR_SIZE = 512
export const MAX_AVATAR_BYTES = 240 * 1024
const MAX_SOURCE_BYTES = 10 * 1024 * 1024
const MAX_SOURCE_PIXELS = 40_000_000
const webpSignature = (bytes: Uint8Array): boolean =>
  String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'

export async function decodePhoto(file: File): Promise<DecodedPhoto> {
  if (file.size > MAX_SOURCE_BYTES) throw new Error('Choose a photo smaller than 10 MB.')
  if (file.type && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type.toLowerCase())) {
    throw new Error('Choose a JPEG, PNG, or WebP photo.')
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)
  const webp = bytes.length >= 12 && webpSignature(bytes)
  if (!jpeg && !png && !webp) throw new Error('We could not read that photo. Choose a JPEG, PNG, or WebP image.')
  if (webp) {
    const view = new DataView(bytes.buffer)
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const tag = String.fromCharCode(...bytes.subarray(offset, offset + 4))
      const size = view.getUint32(offset + 4, true)
      if (tag === 'ANIM' || tag === 'ANMF' || (tag === 'VP8X' && size >= 10 && (bytes[offset + 8]! & 2))) {
        throw new Error('Choose a still photo. Animated images are not supported.')
      }
      offset += 8 + size + size % 2
    }
  }
  let source: ImageBitmap
  try { source = await createImageBitmap(file, { imageOrientation: 'from-image' }) }
  catch { throw new Error('We could not read that photo. Try a different image.') }
  if (!source.width || !source.height || source.width * source.height > MAX_SOURCE_PIXELS) {
    source.close()
    throw new Error('Choose a photo with fewer than 40 million pixels.')
  }
  let released = false
  return { source, width: source.width, height: source.height, release() { if (!released) { released = true; source.close() } } }
}

export async function encodeAvatar(photo: DecodedPhoto, crop: Crop): Promise<Blob> {
  const bounded = clampCrop(crop, photo.width, photo.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = AVATAR_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Your browser could not prepare this photo.')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(photo.source, bounded.x, bounded.y, bounded.size, bounded.size, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
  for (const quality of [0.85, 0.75, 0.65, 0.55, 0.45]) {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality))
    if (!blob || blob.type !== 'image/webp') throw new Error('Your browser could not encode WebP. Try a newer browser.')
    if (blob.size > MAX_AVATAR_BYTES) continue
    if (!webpSignature(new Uint8Array(await blob.slice(0, 12).arrayBuffer()))) throw new Error('Your browser could not encode a valid WebP photo.')
    return blob
  }
  throw new Error('We could not resize this photo below 240 KiB. Choose a simpler image.')
}
