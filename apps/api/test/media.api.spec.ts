import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { avatarWebp } from './fixtures/media'
import { api, rawApi, createTestUser, loginAs, impersonatedCookieFor, resetIsolateCaches, type Envelope, type ErrorEnvelope } from './helpers'
import { uploadAvatar } from '../src/services/media.service'
import { standaloneEntry } from '../src/services/audit.service'
import type { Auditor, MediaDto } from '../src/types'

beforeEach(resetIsolateCaches)
const upload = (cookie?: string, body = avatarWebp(), mime = 'image/webp', kind = 'avatar') =>
  rawApi('POST', `/api/v1/media?kind=${kind}`, {cookie, body, headers:{'content-type':mime}})
const assetOf = async (response: Response): Promise<MediaDto> => (await response.json() as Envelope<MediaDto>).data
function auditor(): Auditor {
  const entries: Auditor['entries'][number][] = []
  return {get handled(){return entries.length>0}, entries, claim(draft){const entry=standaloneEntry(draft,'media-test-request');entries.push(entry);return entry}}
}

describe('avatar upload and public serving', () => {
  it('stores and publicly serves exact bytes with correct headers and metadata', async () => {
    const user=await createTestUser(), cookie=await loginAs(user), bytes=avatarWebp()
    expect((await api<Envelope<{media:null}>>('GET','/api/v1/media/avatar',{cookie})).body.data.media).toBeNull()
    const response=await upload(cookie,bytes); expect(response.status).toBe(201)
    const media=await assetOf(response)
    expect(media).toMatchObject({key:`avatars/${user.id}/${media.id}.webp`,width:512,height:512,bytes:bytes.length})
    const object=await env.PUBLIC_BUCKET.get(media.key)
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(bytes)
    const image=await rawApi('GET',media.url)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/webp')
    expect(image.headers.get('etag')).toBeTruthy()
    expect(image.headers.get('cache-control')).toBe('no-store')
    expect(image.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(bytes)
    const audit=await env.DB.prepare("SELECT count(*) AS n FROM audit_logs WHERE action='media.upload' AND target_id=?").bind(media.id).first<{n:number}>()
    expect(audit?.n).toBe(1)
  })
  it('uses distinct immutable keys for identical files from two users',async()=>{
    const a=await createTestUser(), b=await createTestUser()
    const first=await assetOf(await upload(await loginAs(a))), second=await assetOf(await upload(await loginAs(b)))
    expect(first.key).not.toBe(second.key)
    expect(first.key).toContain(a.id);expect(second.key).toContain(b.id)
  })
  it('enforces authentication, account, password, and impersonation guards',async()=>{
    expect((await upload()).status).toBe(401)
    const suspended=await createTestUser(), suspendedCookie=await loginAs(suspended)
    await env.DB.prepare("UPDATE users SET status='suspended',status_reason='test',suspended_until=? WHERE id=?").bind(Date.now()+100000,suspended.id).run()
    expect((await upload(suspendedCookie)).status).toBe(403)
    const forced=await createTestUser({requirePasswordChange:true})
    expect((await upload(await loginAs(forced))).status).toBe(403)
    expect((await upload(await impersonatedCookieFor('media-support','Disposable-password-84!'))).status).toBe(403)
  })
  it('rejects invalid kind, MIME, empty bytes, and both byte caps',async()=>{
    const cookie=await loginAs(await createTestUser())
    for(const response of [await upload(cookie,avatarWebp(),'image/png'),await upload(cookie,new Uint8Array()),await upload(cookie,avatarWebp(),'image/webp','page_image')])
      expect(response.status).toBe(422)
    expect((await upload(cookie,new Uint8Array(240*1024+1))).status).toBe(413)
    expect((await upload(cookie,new Uint8Array(256*1024+1))).status).toBe(413)
  })
  it('returns 429 and retry-after on the seeded 60-per-hour throttle',async()=>{
    const cookie=await loginAs(await createTestUser())
    for(let i=0;i<60;i++) expect((await upload(cookie,new Uint8Array())).status).toBe(422)
    const response=await upload(cookie)
    expect(response.status).toBe(429); expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await response.json() as ErrorEnvelope).error.code).toBe('RATE_LIMITED')
  })
  it('refuses missing and inactive objects rather than returning SPA HTML',async()=>{
    const media=await assetOf(await upload(await loginAs(await createTestUser())))
    await env.PUBLIC_BUCKET.delete(media.key)
    expect((await rawApi('GET',media.url)).status).toBe(404)
    expect((await rawApi('GET','/api/v1/media/files/avatars/u/invalid.webp')).status).toBe(404)
  })
  it('compensates a failed database commit and logs failed compensation safely',async()=>{
    const user=await createTestUser(), actor={id:user.id,role:user.role,label:user.username}
    const failedDb=new Proxy(env.DB,{get(target,key){if(key==='batch')return async()=>{throw new Error('injected commit failure')};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v}})
    await expect(uploadAvatar({...env,DB:failedDb},actor,avatarWebp(),'image/webp',auditor())).rejects.toThrow('injected commit failure')
    expect((await env.PUBLIC_BUCKET.list()).objects).toHaveLength(0)
    const failedBucket=new Proxy(env.PUBLIC_BUCKET,{get(target,key){if(key==='delete')return async()=>{throw new Error('injected cleanup failure')};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v}})
    const log=vi.spyOn(console,'error').mockImplementation(()=>{})
    try{
      await expect(uploadAvatar({...env,DB:failedDb,PUBLIC_BUCKET:failedBucket},actor,avatarWebp(),'image/webp',auditor())).rejects.toThrow('injected commit failure')
      expect(log).toHaveBeenCalledWith(expect.stringContaining('media_upload_compensation_failed'))
      expect(log).toHaveBeenCalledWith(expect.stringContaining('media-test-request'))
    }finally{log.mockRestore()}
  })
})
