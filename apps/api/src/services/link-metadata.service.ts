import { badRequest } from '../lib/errors'
import { sanitizeSingleLine } from '../lib/http'

const MAX_HTML_BYTES = 512 * 1024
const MAX_REDIRECTS = 3
const FETCH_TIMEOUT_MS = 5_000
const DNS_JSON_ENDPOINT = 'https://cloudflare-dns.com/dns-query'

function parseIpv4(host: string): number[] | null {
  const parts = host.split('.')
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part))) return null
  const octets = parts.map(Number)
  return octets.every(part => part >= 0 && part <= 255) ? octets : null
}

function isPublicIpv4(octets: number[]): boolean {
  const a = octets[0] ?? 0
  const b = octets[1] ?? 0
  const c = octets[2] ?? 0
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  )
}

function parseIpv6(host: string): number[] | null {
  let value = host.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0] ?? ''
  if (value.includes('.')) {
    const separator = value.lastIndexOf(':')
    const ipv4 = parseIpv4(value.slice(separator + 1))
    if (!ipv4) return null
    const first = ((ipv4[0] ?? 0) << 8) | (ipv4[1] ?? 0)
    const second = ((ipv4[2] ?? 0) << 8) | (ipv4[3] ?? 0)
    value = `${value.slice(0, separator + 1)}${first.toString(16)}:${second.toString(16)}`
  }
  if ((value.match(/::/g) ?? []).length > 1) return null
  const halves = value.split('::')
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length > 1 && halves[1] ? halves[1].split(':') : []
  if ([...left, ...right].some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null
  return [
    ...left.map(part => Number.parseInt(part, 16)),
    ...Array.from({ length: missing }, () => 0),
    ...right.map(part => Number.parseInt(part, 16)),
  ]
}

function isPublicIpv6(words: number[]): boolean {
  const first = words[0] ?? 0
  const second = words[1] ?? 0
  return (first & 0xe000) === 0x2000 &&
    first !== 0x2002 &&
    !(first === 0x2001 && (second <= 0x01ff || second === 0x0db8)) &&
    first !== 0x3fff
}

export function assertSafeMetadataUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw badRequest('That is not a usable link URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw badRequest('Metadata can only be fetched from http(s) links.')
  }
  if (url.username || url.password) throw badRequest('Links with embedded credentials cannot be fetched.')
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw badRequest('Metadata links may only use standard HTTP or HTTPS ports.')
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    throw badRequest('That host is not available for metadata fetching.')
  }

  const ipv4 = parseIpv4(host)
  if (ipv4 && !isPublicIpv4(ipv4)) throw badRequest('Private and reserved network addresses cannot be fetched.')
  if (host.includes(':')) {
    const ipv6 = parseIpv6(host)
    if (!ipv6 || !isPublicIpv6(ipv6)) {
      throw badRequest('Private and reserved network addresses cannot be fetched.')
    }
  }
  return url
}

/**
 * Hostnames are resolved through a fixed DNS-over-HTTPS endpoint before fetch.
 * Every returned address must be globally routable; a missing answer fails
 * closed. Fetch follows redirects manually and repeats this check for each hop.
 */
export async function assertPublicHostnameResolved(
  url: URL,
  resolverFetch: typeof fetch = fetch,
): Promise<void> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (parseIpv4(hostname) || hostname.includes(':')) return
  const addresses: string[] = []
  for (const type of ['A', 'AAAA'] as const) {
    const query = new URL(DNS_JSON_ENDPOINT)
    query.searchParams.set('name', hostname)
    query.searchParams.set('type', type)
    const response = await resolverFetch(query, {
      headers: { accept: 'application/dns-json' },
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) throw badRequest('The destination host could not be resolved.')
    const answer = await response.json() as {
      Status?: number
      Answer?: Array<{ type?: number; data?: string }>
    }
    if (answer.Status !== 0 && answer.Status !== 3) {
      throw badRequest('The destination host could not be resolved.')
    }
    for (const record of answer.Answer ?? []) {
      if ((type === 'A' && record.type === 1) || (type === 'AAAA' && record.type === 28)) {
        if (typeof record.data !== 'string') throw badRequest('The destination host returned an invalid address.')
        const address = record.data.replace(/^\[|\]$/g, '')
        const ipv4 = parseIpv4(address)
        const safe = ipv4 ? isPublicIpv4(ipv4) : isPublicIpv6(parseIpv6(address) ?? [])
        if (!safe) throw badRequest('Private and reserved network addresses cannot be fetched.')
        addresses.push(address)
      }
    }
  }
  if (addresses.length === 0) throw badRequest('The destination host has no public address.')
}

async function readBoundedHtml(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_HTML_BYTES) {
    throw badRequest('The destination page is too large to inspect.')
  }
  const reader = response.body?.getReader()
  if (!reader) return ''

  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_HTML_BYTES) {
        await reader.cancel()
        throw badRequest('The destination page is too large to inspect.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(bytes)
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  }
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, token: string) => {
    if (token.startsWith('#x') || token.startsWith('#X')) {
      const point = Number.parseInt(token.slice(2), 16)
      return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : entity
    }
    if (token.startsWith('#')) {
      const point = Number.parseInt(token.slice(1), 10)
      return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : entity
    }
    return named[token.toLowerCase()] ?? entity
  })
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null
}

function metadataFromHtml(html: string): { title: string | null; description: string | null } {
  const head = /<head\b[^>]*>([\s\S]*?)(?:<\/head\s*>|$)/i.exec(html)?.[1] ?? html.slice(0, 64 * 1024)
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1]
  let description: string | null = null
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = (attribute(tag, 'name') ?? attribute(tag, 'property') ?? '').toLowerCase()
    if (name === 'description' || name === 'og:description') {
      description = attribute(tag, 'content')
      if (description) break
    }
  }
  const title = titleTag ? sanitizeSingleLine(decodeEntities(titleTag.replace(/<[^>]*>/g, '')), 200) || null : null
  description = description ? sanitizeSingleLine(decodeEntities(description), 280) || null : null
  return { title, description }
}

export async function fetchLinkMetadata(
  input: string,
  fetcher: typeof fetch = fetch,
  resolveHost: (url: URL) => Promise<void> = url => assertPublicHostnameResolved(url),
): Promise<{ url: string; title: string | null; description: string | null }> {
  let url = assertSafeMetadataUrl(input)
  for (let redirects = 0; ; redirects += 1) {
    await resolveHost(url)
    const response = await fetcher(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { accept: 'text/html,application/xhtml+xml;q=0.9' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects >= MAX_REDIRECTS) throw badRequest('The destination redirected too many times.')
      const location = response.headers.get('location')
      if (!location) throw badRequest('The destination returned an invalid redirect.')
      url = assertSafeMetadataUrl(new URL(location, url).toString())
      continue
    }
    if (!response.ok) throw badRequest('The destination page could not be fetched.')
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (contentType !== 'text/html' && contentType !== 'application/xhtml+xml') {
      return { url: url.toString(), title: null, description: null }
    }
    return { url: url.toString(), ...metadataFromHtml(await readBoundedHtml(response)) }
  }
}
