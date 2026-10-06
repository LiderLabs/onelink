import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { avatarWebp } from './fixtures/media'
import { api, rawApi, createTestUser, loginAs, impersonatedCookieFor, resetIsolateCaches, type Envelope, type ErrorEnvelope } from './helpers'
import { uploadAvatar, deleteOwnedAvatar } from '../src/services/avatar.service'
import { cleanupAvatarMedia } from '../src/services/media-maintenance.service'
import { updateOwnProfile } from '../src/services/user.service'
import { standaloneEntry } from '../src/services/audit.service'
import type { Auditor, MediaDto } from '../src/types'

beforeEach(resetIsolateCaches)
const upload = (cookie?: string, body = avatarWebp(), mime = 'image/webp', kind = 'avatar') =>
  rawApi('POST', `/api/v1/media/avatar?kind=${kind}`, {cookie, body, headers:{'content-type':mime}})
const assetOf = async (response: Response): Promise<MediaDto> => (await response.json() as Envelope<MediaDto>).data
function auditor(): Auditor {
  const entries: Auditor['entries'][number][] = []
  return {get handled(){return entries.length>0}, entries, claim(draft){const entry=standaloneEntry(draft,'media-test-request');entries.push(entry);return entry}}
}

describe('avatar upload and public serving', () => {
  it('reads and retires an existing PNG avatar through the managed editor API',async()=>{
    const cookie=await loginAs(await createTestUser()), bytes=new Uint8Array(24)
    bytes.set([137,80,78,71,13,10,26,10]);bytes.set([73,72,68,82],12)
    new DataView(bytes.buffer).setUint32(16,512);new DataView(bytes.buffer).setUint32(20,512)
    const media=await assetOf(await rawApi('POST','/api/v1/media?kind=avatar',{cookie,body:bytes,headers:{'content-type':'image/png'}}))
    expect((await api('PATCH','/api/v1/auth/me',{cookie,body:{avatarKey:media.key}})).status).toBe(200)
    const metadata=await api<Envelope<{media:MediaDto}>>('GET','/api/v1/media/avatar',{cookie})
    expect(metadata.body.data.media.key).toBe(media.key)
    const image=await rawApi('GET',`/api/v1/media/files/${media.key}`)
    expect(image.status).toBe(200);expect(image.headers.get('content-type')).toBe('image/png')
    expect((await api('DELETE',`/api/v1/media/avatar/${media.id}`,{cookie})).status).toBe(204)
    expect((await rawApi('GET',media.url)).status).toBe(404)
    expect((await api<Envelope<{user:{avatarKey:null}}>>('GET','/api/v1/auth/me',{cookie})).body.data.user.avatarKey).toBeNull()
  })
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
  it('tracks failed storage compensation so scheduled cleanup can retry it',async()=>{
    const user=await createTestUser(), actor={id:user.id,role:user.role,label:user.username}
    const failedDb=new Proxy(env.DB,{get(target,key){if(key==='batch')return async()=>{throw new Error('injected commit failure')};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v}})
    await expect(uploadAvatar({...env,DB:failedDb},actor,avatarWebp(),'image/webp',auditor())).rejects.toThrow('injected commit failure')
    expect((await env.PUBLIC_BUCKET.list()).objects).toHaveLength(0)
    const failedBucket=new Proxy(env.PUBLIC_BUCKET,{get(target,key){if(key==='delete')return async()=>{throw new Error('injected cleanup failure')};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v}})
    const log=vi.spyOn(console,'error').mockImplementation(()=>{})
    let deferredKey: string | null = null
    try{
      await expect(uploadAvatar({...env,DB:failedDb,PUBLIC_BUCKET:failedBucket},actor,avatarWebp(),'image/webp',auditor()))
        .rejects.toThrow('injected commit failure')
      const tracked = await env.DB.prepare(
        "SELECT id,r2_key,status FROM media_assets WHERE owner_user_id=? AND status='deleted' ORDER BY created_at DESC LIMIT 1",
      ).bind(user.id).first<{ id: string; r2_key: string; status: string }>()
      deferredKey = tracked?.r2_key ?? null
      expect(tracked?.status).toBe('deleted')
      expect(log).toHaveBeenCalledWith(expect.stringContaining('media_upload_cleanup_deferred'))
      expect(log).toHaveBeenCalledWith(expect.stringContaining('media-test-request'))
    }finally{log.mockRestore()}
    expect(deferredKey).not.toBeNull()
    expect(await cleanupAvatarMedia(env)).toMatchObject({ removed: 1, failed: 0 })
    expect(await env.PUBLIC_BUCKET.get(deferredKey!)).toBeNull()
  })
})

describe('avatar attachment and deletion',()=>{
  const attach=(cookie:string,avatarKey:string|null,expectedAvatarKey:string|null)=>api<Envelope<{user:{avatarKey:string|null}}>>('PATCH','/api/v1/auth/me',{cookie,body:{avatarKey,expectedAvatarKey}})
  it('attaches owned media, reads metadata, clears with null, and preserves identity-only writes',async()=>{
    const cookie=await loginAs(await createTestUser()), media=await assetOf(await upload(cookie))
    expect((await attach(cookie,media.key,null)).body.data.user.avatarKey).toBe(media.key)
    expect((await api<Envelope<{media:MediaDto}>>('GET','/api/v1/media/avatar',{cookie})).body.data.media.id).toBe(media.id)
    expect((await api<Envelope<{user:{avatarKey:string}}>>('PATCH','/api/v1/auth/me',{cookie,body:{bio:'Photo stays'}})).body.data.user.avatarKey).toBe(media.key)
    expect((await attach(cookie,null,media.key)).body.data.user.avatarKey).toBeNull()
  })
  it('rejects missing and standalone preconditions; stale changes have no success audit',async()=>{
    const cookie=await loginAs(await createTestUser()), media=await assetOf(await upload(cookie))
    expect((await api('PATCH','/api/v1/auth/me',{cookie,body:{avatarKey:media.key}})).status).toBe(400)
    expect((await api('PATCH','/api/v1/auth/me',{cookie,body:{expectedAvatarKey:null,bio:'No'}})).status).toBe(422)
    expect((await attach(cookie,media.key,null)).status).toBe(200)
    const stale=await attach(cookie,null,null);expect(stale.status).toBe(409)
    const row=await env.DB.prepare("SELECT count(*) AS n FROM audit_logs WHERE request_id=? AND status='success'").bind(stale.headers.get('x-request-id')).first<{n:number}>()
    expect(row?.n).toBe(0)
  })
  it('refuses foreign, unknown, deleted, private and wrong-kind assets',async()=>{
    const cookie=await loginAs(await createTestUser()), other=await loginAs(await createTestUser())
    const foreign=await assetOf(await upload(other))
    expect((await attach(cookie,foreign.key,null)).status).toBe(404)
    expect((await attach(cookie,'avatars/unknown/01ARZ3NDEKTSV4RRFFQ69G5FAV.webp',null)).status).toBe(404)
    for(const patch of ["status='deleted'","bucket='private'","kind='page_image'"]){
      const media=await assetOf(await upload(cookie));await env.DB.prepare(`UPDATE media_assets SET ${patch} WHERE id=?`).bind(media.id).run()
      expect((await attach(cookie,media.key,null)).status).toBe(404)
    }
  })
  it('deletes object and row, clears only a matching pointer, and is idempotent',async()=>{
    const cookie=await loginAs(await createTestUser()), old=await assetOf(await upload(cookie)), next=await assetOf(await upload(cookie))
    await attach(cookie,old.key,null);await attach(cookie,next.key,old.key)
    expect((await api('DELETE',`/api/v1/media/avatar/${old.id}`,{cookie})).status).toBe(204)
    expect((await env.PUBLIC_BUCKET.get(old.key))).toBeNull()
    expect((await rawApi('GET',old.url)).status).toBe(404)
    expect((await api<Envelope<{user:{avatarKey:string}}>>('GET','/api/v1/auth/me',{cookie})).body.data.user.avatarKey).toBe(next.key)
    expect((await api('DELETE',`/api/v1/media/avatar/${next.id}`,{cookie})).status).toBe(204)
    expect((await api<Envelope<{user:{avatarKey:null}}>>('GET','/api/v1/auth/me',{cookie})).body.data.user.avatarKey).toBeNull()
    expect((await api('DELETE',`/api/v1/media/avatar/${next.id}`,{cookie})).status).toBe(204)
    expect(await env.DB.prepare('SELECT id FROM media_assets WHERE id=?').bind(next.id).first()).toBeNull()
  })
  it('does not delete or disclose existing foreign assets',async()=>{
    const owner=await loginAs(await createTestUser()), other=await loginAs(await createTestUser()), media=await assetOf(await upload(owner))
    expect((await api('DELETE',`/api/v1/media/avatar/${media.id}`,{cookie:other})).status).toBe(404)
    expect(await env.PUBLIC_BUCKET.get(media.key)).not.toBeNull()
    expect((await api('DELETE',`/api/v1/media/avatar/${media.id}`)).status).toBe(401)
  })
  it('retains a marked row after storage failure, refuses attachment, and retries deletion',async()=>{
    const user=await createTestUser(), cookie=await loginAs(user), media=await assetOf(await upload(cookie))
    await attach(cookie,media.key,null)
    const failedBucket=new Proxy(env.PUBLIC_BUCKET,{get(target,key){if(key==='delete')return async()=>{throw new Error('storage unavailable')};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}})
    const actor={id:user.id,role:user.role,label:user.username}
    await expect(deleteOwnedAvatar({...env,PUBLIC_BUCKET:failedBucket},actor,media.id,auditor())).rejects.toThrow('storage unavailable')
    expect((await env.DB.prepare('SELECT status FROM media_assets WHERE id=?').bind(media.id).first<{status:string}>())?.status).toBe('deleted')
    expect((await rawApi('GET',media.url)).status).toBe(404)
    expect((await attach(cookie,media.key,null)).status).toBe(404)
    expect((await rawApi('GET',`/api/v1/media/${media.key}`)).status).toBe(404)
    await deleteOwnedAvatar(env,actor,media.id,auditor())
    expect(await env.PUBLIC_BUCKET.get(media.key)).toBeNull()
  })
  it('permits one winner when two attachments race with the same precondition',async()=>{
    const user=await createTestUser(), cookie=await loginAs(user), first=await assetOf(await upload(cookie)), second=await assetOf(await upload(cookie))
    const result=await Promise.all([attach(cookie,first.key,null),attach(cookie,second.key,null)])
    expect(result.map(r=>r.status).sort()).toEqual([200,409])
    const row=await env.DB.prepare("SELECT count(*) AS n FROM audit_logs WHERE action='user.profile_update' AND status='success'").first<{n:number}>()
    expect(row?.n).toBe(1)
  })
  it('does not attach an asset deleted between validation and the atomic update',async()=>{
    const user=await createTestUser(), cookie=await loginAs(user), media=await assetOf(await upload(cookie))
    let interleaved=false
    const racedDb=new Proxy(env.DB,{get(target,key){if(key==='batch')return async(statements:D1PreparedStatement[])=>{
      if(!interleaved){interleaved=true;await env.DB.prepare("UPDATE media_assets SET status='deleted' WHERE id=?").bind(media.id).run()}
      return target.batch(statements)
    };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}})
    await expect(updateOwnProfile(racedDb,{id:user.id,role:user.role,label:user.username},{avatarKey:media.key,expectedAvatarKey:null},auditor())).rejects.toMatchObject({status:409})
    expect((await env.DB.prepare('SELECT avatar_key FROM users WHERE id=?').bind(user.id).first<{avatar_key:null}>())?.avatar_key).toBeNull()
  })
})
