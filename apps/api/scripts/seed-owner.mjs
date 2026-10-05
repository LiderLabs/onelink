#!/usr/bin/env node
// ============================================================================
// OneLink — scripts/seed-owner.mjs
//
// Creates (or resets) the `owner` account. Hashing must be byte-identical to
// the Worker's `src/lib/crypto.ts`:
//
//     pbkdf2$sha256$<iterations>$<saltBase64>$<hashBase64>
//
// PBKDF2-SHA256 is a standard construction, so Node's `pbkdf2Sync` and the
// Workers `crypto.subtle.deriveBits` produce the same output for the same
// inputs. Both use standard base64 (with padding) over the raw bytes.
//
// Usage:
//   node scripts/seed-owner.mjs                     # local, reads .dev.vars
//   node scripts/seed-owner.mjs --remote
//   node scripts/seed-owner.mjs --email a@b.c --password 'hunter2hunter2'
//
// The hash string is passed to Wrangler via a bound parameter, never a
// shell-interpolated literal.
// ============================================================================
import { randomBytes, pbkdf2Sync, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const API_ROOT = path.resolve(HERE, '..')

const require = createRequire(import.meta.url)

/**
 * Wrangler's CLI entry point, run through the current Node binary.
 *
 * Deliberately NOT `npx.cmd wrangler …`: Node ≥ 20.12 refuses to spawn `.cmd`
 * shims unless `shell: true` is set (EINVAL), and enabling a shell would mean
 * re-parsing the temp SQL path — so this resolves the real JS entry instead.
 * That keeps the call shell-free on every platform and drops an npx process.
 */
const WRANGLER_ENTRY = path.join(
  path.dirname(require.resolve('wrangler/package.json')),
  'bin',
  'wrangler.js',
)

// Must stay within workerd's WebCrypto ceiling (100 000 PBKDF2 iterations, see
// MAX_SUPPORTED_ITERATIONS in src/lib/crypto.ts). Node itself would happily hash
// at 600 000, but the Worker refuses to *verify* anything above the ceiling — so
// seeding higher produces an "owner account" that can never log in.
const DEFAULT_ITERATIONS = 100_000
const MIN_PASSWORD_LENGTH = 8
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Uppercase Crockford Base32 ULID — mirrors src/lib/ids.ts. */
function ulid(time = Date.now()) {
  let t = BigInt(time)
  let ts = ''
  for (let i = 0; i < 10; i++) {
    ts = CROCKFORD[Number(t & 31n)] + ts
    t >>= 5n
  }
  let r = 0n
  for (const byte of randomBytes(10)) r = (r << 8n) | BigInt(byte)
  let rs = ''
  for (let i = 0; i < 16; i++) {
    rs = CROCKFORD[Number(r & 31n)] + rs
    r >>= 5n
  }
  return ts + rs
}

function hashPassword(password, iterations = DEFAULT_ITERATIONS) {
  const salt = randomBytes(16)
  const derived = pbkdf2Sync(password, salt, iterations, 32, 'sha256')
  return [
    'pbkdf2',
    'sha256',
    iterations,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$')
}

/** Minimal KEY=VALUE reader for .dev.vars (no quoting/interpolation). */
function readDevVars() {
  const file = path.join(API_ROOT, '..', '..', '.dev.vars')
  const out = {}
  if (!existsSync(file)) return out
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return out
}

function parseArgs(argv) {
  const args = { remote: false, email: null, password: null }
  for (const arg of argv) {
    if (arg === '--remote') args.remote = true
    else if (arg === '--local') args.remote = false
    else if (arg.startsWith('--email=')) args.email = arg.slice(8)
    else if (arg.startsWith('--password=')) args.password = arg.slice(11)
    else {
      console.error(`Unknown argument: ${arg}`)
      process.exit(1)
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const devVars = readDevVars()

// Report which file the credentials came from. Two `.dev.vars` files can exist
// on disk — `apps/api/.dev.vars` is generated for wrangler by sync-dev-vars.mjs —
// and a silent mismatch between the file this script hashes from and the one the
// Worker actually reads only ever surfaces much later, as "the password is
// wrong".
console.log(
  `Owner credentials from ${path.join(API_ROOT, '..', '..', '.dev.vars')} (${Object.keys(devVars).length} keys)`,
)

const email = (args.email ?? devVars.OWNER_EMAIL ?? process.env.OWNER_EMAIL ?? '').trim().toLowerCase()
const password = args.password ?? devVars.OWNER_PASSWORD ?? process.env.OWNER_PASSWORD ?? ''

if (!email || !email.includes('@')) {
  console.error('Missing/invalid owner email. Set OWNER_EMAIL in .dev.vars or pass --email=')
  process.exit(1)
}
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`Owner password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  process.exit(1)
}

const now = Date.now()
const userId = ulid(now)
const username = email.split('@')[0].replace(/[^a-z0-9_.-]/gi, '').slice(0, 32) || `owner${now}`
const passwordHash = hashPassword(password)

// One statement, so `wrangler d1 execute` cannot half-apply it.
// Re-running resets the owner's credential without disturbing anything else
// (the ON CONFLICT branch keeps the existing row, including its id).
const sql = `
INSERT INTO users (
  id, email, username, display_name, email_verified, email_verified_at,
  password_hash, password_changed_at, require_password_change,
  role, status, status_changed_at, created_at, updated_at
) VALUES (
  '${userId}', '${email}', '${username}', 'Owner', 1, ${now},
  '${passwordHash}', NULL, 1,
  'owner', 'active', ${now}, ${now}, ${now}
)
ON CONFLICT(email) DO UPDATE SET
  password_hash           = excluded.password_hash,
  password_changed_at     = NULL,
  require_password_change = 1,
  email_verified          = 1,
  email_verified_at       = excluded.email_verified_at,
  role                    = 'owner',
  status                  = 'active',
  status_reason           = NULL,
  suspended_until         = NULL,
  suspended_permanently   = 0,
  failed_login_count      = 0,
  locked_until            = NULL,
  deleted_at              = NULL,
  updated_at              = excluded.updated_at;
`

const tmpDir = mkdtempSync(path.join(tmpdir(), 'onelink-seed-'))
const sqlFile = path.join(tmpDir, `owner-${randomUUID()}.sql`)
writeFileSync(sqlFile, sql, 'utf8')

try {
  const target = args.remote ? '--remote' : '--local'
  console.log(`Seeding owner into D1 (${args.remote ? 'remote' : 'local'})...`)
  execFileSync(
    process.execPath,
    [WRANGLER_ENTRY, 'd1', 'execute', 'onelink-db', target, '--file', sqlFile, '--yes'],
    { cwd: API_ROOT, stdio: 'inherit' },
  )

  console.log('')
  console.log('  Owner account ready — CHANGE THIS PASSWORD ON FIRST LOGIN')
  console.log('  ----------------------------------------------------------')
  console.log(`  email    : ${email}`)
  console.log(`  username : ${username}   (also accepted at login)`)
  console.log(`  password : ${args.password ? '(from --password)' : password}`)
  console.log(`  user id  : ${userId}`)
  console.log('')
} finally {
  rmSync(tmpDir, { recursive: true, force: true })
}
