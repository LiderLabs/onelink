import { describe, expect, it, vi } from 'vitest'
import {
  assertPublicHostnameResolved,
  assertSafeMetadataUrl,
  fetchLinkMetadata,
} from '../src/services/link-metadata.service'

describe('link metadata SSRF protection', () => {
  it.each([
    'http://127.0.0.1/',
    'http://0.0.0.0/',
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://192.168.1.1/',
    'http://100.64.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://224.0.0.1/',
    'http://198.51.100.10/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fc00::1]/',
    'http://[fe80::1]/',
    'http://[2001:db8::1]/',
    'http://localhost/',
    'http://metadata.google.internal/',
    'http://example.com:8080/',
    'file:///etc/passwd',
  ])('refuses unsafe target %s', (input) => {
    expect(() => assertSafeMetadataUrl(input)).toThrow()
  })

  it('follows only bounded redirects and revalidates every redirect target', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }),
    )
    await expect(fetchLinkMetadata('https://public.example/', fetcher, async () => {})).rejects.toThrow(/private and reserved/i)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('caps redirect chains', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://public.example/next' } }),
    )
    await expect(fetchLinkMetadata('https://public.example/', fetcher, async () => {})).rejects.toThrow(/redirected too many/i)
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('caps the response body even when content-length is absent', async () => {
    const body = new Uint8Array(512 * 1024 + 1)
    const response = new Response(body, { headers: { 'content-type': 'text/html' } })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response)
    await expect(fetchLinkMetadata('https://public.example/', fetcher, async () => {})).rejects.toThrow(/too large/i)
  })

  it('returns only bounded title and description metadata, never the HTML', async () => {
    const html = `<!doctype html><html><head>
      <title>Example &amp; One</title>
      <meta name="description" content="A useful &quot;description&quot;">
    </head><body>private response content</body></html>`
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    )
    await expect(fetchLinkMetadata('https://public.example/path', fetcher, async () => {})).resolves.toEqual({
      url: 'https://public.example/path',
      title: 'Example & One',
      description: 'A useful "description"',
    })
  })

  it('returns null metadata for non-HTML documents', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('image bytes', { headers: { 'content-type': 'image/png' } }),
    )
    await expect(fetchLinkMetadata('https://public.example/image.png', fetcher, async () => {})).resolves.toEqual({
      url: 'https://public.example/image.png',
      title: null,
      description: null,
    })
  })

  it('refuses a hostname with any private DNS answer', async () => {
    const resolver = vi.fn<typeof fetch>().mockImplementation(async input => {
      const query = new URL(String(input))
      return new Response(JSON.stringify(query.searchParams.get('type') === 'A'
        ? { Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }
        : { Status: 0, Answer: [{ type: 28, data: 'fd00::1' }] }), {
        headers: { 'content-type': 'application/dns-json' },
      })
    })
    await expect(assertPublicHostnameResolved(new URL('https://public.example/'), resolver))
      .rejects.toThrow(/private and reserved/i)
    expect(resolver).toHaveBeenCalledTimes(2)
  })
})
