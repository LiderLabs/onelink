// ============================================================================
// ULID generation — uppercase Crockford Base32, 26 chars.
//
// Layout: 10 chars of 48-bit epoch-ms + 16 chars of 80-bit randomness.
// Lexicographic order == chronological order, which keeps `created_at DESC`
// indexes and keyset pagination cheap.
//
// Must stay byte-identical to the implementation in scripts/seed-owner.mjs.
// ============================================================================

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/

export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && ULID_REGEX.test(value)
}

export function ulid(time: number = Date.now()): string {
  // 48-bit big-endian timestamp, most-significant char first.
  let remaining = BigInt(time)
  let timestamp = ''
  for (let i = 0; i < 10; i++) {
    timestamp = CROCKFORD.charAt(Number(remaining & 31n)) + timestamp
    remaining >>= 5n
  }

  // 80 bits of entropy.
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  let random = 0n
  for (const byte of bytes) random = (random << 8n) | BigInt(byte)

  let encoded = ''
  for (let i = 0; i < 16; i++) {
    encoded = CROCKFORD.charAt(Number(random & 31n)) + encoded
    random >>= 5n
  }

  return timestamp + encoded
}

export function newId(): string {
  return ulid()
}
