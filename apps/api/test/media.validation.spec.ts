import { describe, expect, it } from 'vitest'
import { validateAvatarWebp, mediaUrl, MAX_AVATAR_BYTES } from '../src/lib/avatar'
import { avatarWebp, riff } from './fixtures/media'

describe('bounded avatar WebP validation', () => {
  for (const kind of ['lossy', 'lossless', 'alpha'] as const) {
    it(`accepts a real ${kind} 512-square image`, () => {
      const bytes = avatarWebp(kind)
      expect(validateAvatarWebp(bytes, 'image/webp')).toEqual({mime:'image/webp',width:512,height:512,bytes:bytes.length})
    })
  }
  it('rejects an avatar beyond 240 KiB before inspecting it', () => {
    expect(() => validateAvatarWebp(new Uint8Array(MAX_AVATAR_BYTES + 1), 'image/webp')).toThrowError(expect.objectContaining({status:413}))
  })
  it('rejects MIME mismatch and empty/unknown data', () => {
    for (const [bytes, mime] of [[avatarWebp(),'image/png'], [new Uint8Array(),'image/webp'], [new TextEncoder().encode('not webp'),'image/webp']] as const)
      expect(() => validateAvatarWebp(bytes,mime)).toThrowError(expect.objectContaining({status:422}))
  })
  it('rejects trailing bytes, truncated chunks and invalid RIFF sizes', () => {
    const bytes=avatarWebp()
    const bad=bytes.slice(); new DataView(bad.buffer).setUint32(4,999999,true)
    const truncated=bytes.slice(0,-4); new DataView(truncated.buffer).setUint32(4,truncated.length-8,true)
    for (const value of [bad,truncated,new Uint8Array([...bytes,0,0])])
      expect(() => validateAvatarWebp(value,'image/webp')).toThrowError(expect.objectContaining({status:422}))
  })
  it('requires exactly 512 by 512 and a real image payload', () => {
    const bytes=avatarWebp(); const wrong=bytes.slice()
    new DataView(wrong.buffer).setUint16(26,511,true)
    const header=new Uint8Array(10); header.set([255,1,0],4); header.set([255,1,0],7)
    for (const value of [wrong,riff(['VP8X',header]),riff(['JUNK',new Uint8Array(8)])])
      expect(() => validateAvatarWebp(value,'image/webp')).toThrowError(expect.objectContaining({status:422}))
  })
  it('rejects animation and conflicting extended dimensions', () => {
    const source=avatarWebp(); const payload=source.slice(20)
    const header=new Uint8Array(10); header.set([255,1,0],4); header.set([255,1,0],7)
    const animated=header.slice(); animated[0]=2
    const mismatched=header.slice(); mismatched[4]=254
    for (const value of [riff(['VP8X',animated],['VP8 ',payload]),riff(['ANIM',new Uint8Array(6)],['VP8 ',payload]),riff(['VP8X',mismatched],['VP8 ',payload]),riff(['VP8 ',payload],['VP8 ',payload])])
      expect(() => validateAvatarWebp(value,'image/webp')).toThrowError(expect.objectContaining({status:422}))
  })
  it('constructs a safe URL and refuses path traversal', () => {
    expect(mediaUrl('avatars/u123/01ARZ3NDEKTSV4RRFFQ69G5FAV.webp')).toBe('/api/v1/media/files/avatars/u123/01ARZ3NDEKTSV4RRFFQ69G5FAV.webp')
    expect(() => mediaUrl('avatars/../secret')).toThrow()
  })
})
