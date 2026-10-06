// ============================================================================
// Password + token cryptography.
//
// Password hashes are self-describing and versioned:
//
//     pbkdf2$sha256$<iterations>$<saltBase64>$<hashBase64>
//
// Storing the iteration count with each hash means the cost can be raised later
// and old hashes upgraded transparently on the next successful login.
//
// Session/reset/invitation tokens are NEVER stored. Only a SHA-256 digest of
// `pepper || token` is persisted, so a leaked database cannot be replayed.
//
// Both hashes are produced by `crypto.subtle`, which workerd implements with
// native (non-JavaScript) code paths.
// ============================================================================

const PBKDF2_ALGORITHM = 'pbkdf2'
const PBKDF2_DIGEST = 'sha256'
const PBKDF2_KEY_BITS = 256
const SALT_BYTES = 16

/**
 * PBKDF2 iteration count used for NEW hashes.
 *
 * 100 000 is the ceiling this runtime enforces: workerd's WebCrypto rejects
 * anything higher with
 *
 *     NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not supported
 *
 * So this is the strongest cost that is actually computable on Workers. The
 * OWASP figure (600 000) is not a tuning option here — it throws, which is how a
 * 600 000 default shipped a deployment where every login, registration and
 * password change answered 500 while the test suite stayed green. The rest of
 * the design absorbs the difference: hashes are uniquely salted, session and
 * reset tokens are peppered with a Worker secret, and every hash records its own
 * count so raising this later rehashes accounts on their next successful login
 * (see `needsRehash`).
 */
export const DEFAULT_PBKDF2_ITERATIONS = 100_000

/**
 * Largest iteration count `crypto.subtle` will accept on this runtime.
 *
 * A hash stored above this ceiling can never be derived, so it is unverifiable
 * by definition — `parsePasswordHash` rejects it rather than letting the failure
 * surface as a 500 out of `deriveBits`.
 */
export const MAX_SUPPORTED_ITERATIONS = 100_000

/** Hard floor: refuse to verify hashes weaker than this. */
export const MIN_ACCEPTED_ITERATIONS = 10_000

// ------------------------------------------------------------------ base64 --

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** base64url, unpadded — safe in cookies, URLs and headers. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ------------------------------------------------------------------ tokens --

/** 256 bits of CSPRNG output as base64url. */
export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

async function sha256Bytes(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return new Uint8Array(digest)
}

function hexOf(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

export async function sha256Hex(input: string): Promise<string> {
  return hexOf(await sha256Bytes(input))
}

/**
 * SHA-256 of raw bytes, hex-encoded (R1.3).
 *
 * A sibling of `sha256Hex` rather than a widened parameter type: that one hashes
 * TEXT, and `media_assets.checksum` is the digest of a file exactly as it was
 * stored. Encoding the bytes to a string first would make the column a digest of
 * an encoding decision instead of a digest of the object — and the object is what
 * a later duplicate sweep would be comparing.
 */
export async function sha256HexOfBytes(bytes: Uint8Array): Promise<string> {
  return hexOf(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
}

/**
 * Digest stored in `sessions.token_hash` & friends.
 *
 * The pepper is a Worker secret, so a stolen database yields nothing replayable.
 * `|` is a safe delimiter: the pepper is operator-chosen and the token is
 * base64url, which cannot contain `|`.
 */
export async function hashToken(token: string, pepper: string): Promise<string> {
  return sha256Hex(`onelink.session.v1|${pepper}|${token}`)
}

/** Constant-time comparison; both inputs are digested first to equalise length. */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256Bytes(a), sha256Bytes(b)])
  return crypto.subtle.timingSafeEqual(left, right)
}

// --------------------------------------------------------------- passwords --

export interface ParsedPasswordHash {
  iterations: number
  salt: Uint8Array
  hash: Uint8Array
}

/**
 * Parses the stored hash. Returns null for anything malformed, weaker than
 * MIN_ACCEPTED_ITERATIONS, or above MAX_SUPPORTED_ITERATIONS.
 *
 * The upper bound is not policy, it is arithmetic: this runtime cannot derive a
 * higher count, so such a hash is unverifiable and must fail *closed* rather
 * than throw out of `derivePassword`.
 */
export function parsePasswordHash(stored: string): ParsedPasswordHash | null {
  const parts = stored.split('$')
  if (parts.length !== 5) return null
  const algorithm = parts[0]
  const digest = parts[1]
  const iterationsRaw = parts[2] ?? ''
  const saltRaw = parts[3] ?? ''
  const hashRaw = parts[4] ?? ''
  if (algorithm !== PBKDF2_ALGORITHM || digest !== PBKDF2_DIGEST) return null

  const iterations = Number.parseInt(iterationsRaw, 10)
  if (!Number.isFinite(iterations) || iterations < MIN_ACCEPTED_ITERATIONS) return null
  if (iterations > MAX_SUPPORTED_ITERATIONS) return null

  try {
    const salt = base64ToBytes(saltRaw)
    const hash = base64ToBytes(hashRaw)
    if (salt.length === 0 || hash.length === 0) return null
    return { iterations, salt, hash }
  } catch {
    return null
  }
}

async function derivePassword(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    PBKDF2_KEY_BITS,
  )
  return new Uint8Array(bits)
}

export async function hashPassword(
  password: string,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS,
): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES)
  crypto.getRandomValues(salt)
  const derived = await derivePassword(password, salt, iterations)
  return [
    PBKDF2_ALGORITHM,
    PBKDF2_DIGEST,
    iterations,
    bytesToBase64(salt),
    bytesToBase64(derived),
  ].join('$')
}

export interface VerifyPasswordResult {
  ok: boolean
  /** True when the stored hash used fewer iterations than we now require. */
  needsRehash: boolean
}

export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
  targetIterations: number = DEFAULT_PBKDF2_ITERATIONS,
): Promise<VerifyPasswordResult> {
  if (!stored) return { ok: false, needsRehash: false }
  const parsed = parsePasswordHash(stored)
  if (!parsed) return { ok: false, needsRehash: false }

  const candidate = await derivePassword(password, parsed.salt, parsed.iterations)
  // Equal length by construction (both PBKDF2-256), so timingSafeEqual is valid.
  const ok = crypto.subtle.timingSafeEqual(candidate, parsed.hash)

  return { ok, needsRehash: ok && parsed.iterations < targetIterations }
}

