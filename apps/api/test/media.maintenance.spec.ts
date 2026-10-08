import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { cleanupPrivateMedia, cleanupPublicMedia } from '../src/services/media-maintenance.service'
import { uploadAvatar } from '../src/services/avatar.service'
import { createMediaAsset, deleteMediaAsset } from '../src/services/media.service'
import { standaloneEntry } from '../src/services/audit.service'
import { app } from '../src/app'
import { mediaUrlFor } from '../src/lib/media'
import type { Role } from '../src/lib/constants'
import { createTestUser, resetIsolateCaches } from './helpers'
import { avatarWebp } from './fixtures/media'
import { ulid } from '../src/lib/ids'
import type { Auditor, MediaDto } from '../src/types'

beforeEach(resetIsolateCaches)
function audit():Auditor {return {handled:true,entries:[],claim:draft=>standaloneEntry(draft)}}
async function seed(count=1):Promise<{userId:string;assets:MediaDto[]}>{
  const user=await createTestUser(), assets:MediaDto[]=[]
  for(let i=0;i<count;i++)assets.push(await uploadAvatar(env,{id:user.id,role:user.role,label:user.username},avatarWebp(),'image/webp',audit()))
  return {userId:user.id,assets}
}
describe('public media maintenance',()=>{
  it('preserves old unattached uploads from the generic media API',async()=>{
    const user=await createTestUser(), reference=Date.now()
    const asset=await createMediaAsset(env.DB,env.PUBLIC_BUCKET,{id:user.id,role:user.role,label:user.username},
      {kind:'avatar',filename:'legacy.webp',bytes:avatarWebp(),declaredType:'image/webp'},audit())
    await env.DB.prepare('UPDATE media_assets SET created_at=? WHERE id=?').bind(reference-86400001,asset.id).run()
    expect(await cleanupPublicMedia(env,reference)).toEqual({removed:0,failed:0})
    expect(await env.PUBLIC_BUCKET.get(asset.key as string)).not.toBeNull()
  })
  it('cleans old unattached and marked assets but protects attached and recent assets',async()=>{
    const {userId,assets}=await seed(4), reference=Date.now()
    await env.DB.prepare('UPDATE media_assets SET created_at=? WHERE id IN (?,?)').bind(reference-86400001,assets[0]!.id,assets[1]!.id).run()
    await env.DB.prepare('UPDATE users SET avatar_key=? WHERE id=?').bind(assets[0]!.key,userId).run()
    await env.DB.prepare("UPDATE media_assets SET status='deleted', deleted_at=? WHERE id=?").bind(reference-86400001,assets[3]!.id).run()
    expect(await cleanupPublicMedia(env,reference)).toEqual({removed:2,failed:0})
    for(const index of [0,2])expect(await env.PUBLIC_BUCKET.get(assets[index]!.key)).not.toBeNull()
    for(const index of [1,3])expect(await env.PUBLIC_BUCKET.get(assets[index]!.key)).toBeNull()
  })
  it('processes at most 100 candidates',async()=>{
    await seed(101);await env.DB.prepare("UPDATE media_assets SET status='deleted', deleted_at=?").bind(Date.now()-86400001).run()
    expect(await cleanupPublicMedia(env)).toEqual({removed:100,failed:0})
    expect((await env.DB.prepare('SELECT count(*) AS n FROM media_assets').first<{n:number}>())?.n).toBe(1)
  })
  it('continues after a storage failure and retains its tracked tombstone',async()=>{
    const {assets}=await seed(2);await env.DB.prepare("UPDATE media_assets SET status='deleted', deleted_at=?").bind(Date.now()-86400001).run()
    const failedBucket=new Proxy(env.PUBLIC_BUCKET,{get(target,key){if(key==='delete')return async(objectKey:string)=>{if(objectKey===assets[0]!.key)throw new Error('storage failure');return target.delete(objectKey)};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}})
    const log=vi.spyOn(console,'error').mockImplementation(()=>{})
    try {expect(await cleanupPublicMedia({...env,PUBLIC_BUCKET:failedBucket})).toEqual({removed:1,failed:1})}finally{log.mockRestore()}
    expect(await env.DB.prepare('SELECT id FROM media_assets WHERE id=?').bind(assets[0]!.id).first()).not.toBeNull()
  })
  it('rechecks attachment after candidate selection',async()=>{
    const {userId,assets}=await seed(), reference=Date.now()
    await env.DB.prepare('UPDATE media_assets SET created_at=?').bind(reference-86400001).run()
    let interleaved=false
    const racedDb=new Proxy(env.DB,{get(target,key){if(key==='batch')return async(statements:D1PreparedStatement[])=>{
      if(!interleaved){interleaved=true;await env.DB.prepare('UPDATE users SET avatar_key=? WHERE id=?').bind(assets[0]!.key,userId).run()}
      return target.batch(statements)
    };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}})
    expect(await cleanupPublicMedia({...env,DB:racedDb},reference)).toEqual({removed:0,failed:0})
    expect(await env.PUBLIC_BUCKET.get(assets[0]!.key)).not.toBeNull()
  })

  it('does not delete R2 when the D1 retirement transaction fails',async()=>{
    const {userId,assets}=await seed()
    const user=await env.DB.prepare('SELECT role,username FROM users WHERE id=?').bind(userId).first<{role: Role;username: string}>()
    const failingDb=new Proxy(env.DB,{get(target,key){if(key==='batch')return async()=>{throw new Error('D1 unavailable')};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}})
    await expect(deleteMediaAsset(failingDb,env.PUBLIC_BUCKET,{id:userId,role:user!.role,label:user!.username},assets[0]!.id,audit())).rejects.toThrow('D1 unavailable')
    expect(await env.DB.prepare('SELECT status FROM media_assets WHERE id=?').bind(assets[0]!.id).first<{status:string}>()).toEqual({status:'active'})
    expect(await env.PUBLIC_BUCKET.get(assets[0]!.key)).not.toBeNull()
  })

  it('tracks a failed upload compensation and retries it from maintenance',async()=>{
    const user=await createTestUser()
    const failingDb=new Proxy(env.DB,{get(target,key){if(key==='batch')return async()=>{throw new Error('D1 activation failed')};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}})
    const failedBucket=new Proxy(env.PUBLIC_BUCKET,{get(target,key){if(key==='delete')return async()=>{throw new Error('R2 delete failed')};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}})
    const log=vi.spyOn(console,'error').mockImplementation(()=>{})
    let key=''
    try {
      await expect(createMediaAsset(failingDb,failedBucket,{id:user.id,role:user.role,label:user.username},
        {kind:'page_image',filename:'page.webp',bytes:avatarWebp(),declaredType:'image/webp'},audit())).rejects.toThrow('D1 activation failed')
      const row=await env.DB.prepare("SELECT r2_key,status FROM media_assets WHERE owner_user_id=? AND kind='page_image'").bind(user.id).first<{r2_key:string;status:string}>()
      expect(row?.status).toBe('deleted')
      key=row!.r2_key
      expect(await env.PUBLIC_BUCKET.get(key)).not.toBeNull()
      const response=await app.request(`http://localhost${mediaUrlFor(key)}`,{},env)
      expect(response.status).toBe(404)
      expect(await cleanupPublicMedia(env,Date.now()+86400001)).toEqual({removed:1,failed:0})
      expect(await env.PUBLIC_BUCKET.get(key)).toBeNull()
      expect(await env.DB.prepare('SELECT id FROM media_assets WHERE r2_key=?').bind(key).first()).toBeNull()
    } finally {log.mockRestore()}
  })
})

describe('private evidence maintenance',()=>{
  it('removes old private evidence tombstones after retrying R2 deletion',async()=>{
    const owner=await createTestUser(), reference=Date.now(), bytes=avatarWebp()
    const id=ulid(), key=`appeal_evidence/${id}/${ulid()}.webp`, createdAt=reference-86400001
    await env.PRIVATE_BUCKET.put(key,bytes,{httpMetadata:{contentType:'image/webp'}})
    await env.DB.prepare(`INSERT INTO media_assets
      (id,owner_user_id,page_id,r2_key,bucket,kind,mime,size_bytes,width,height,checksum,uploaded_by,status,created_at,deleted_at)
      VALUES(?,?,NULL,?,'private','appeal_evidence','image/webp',?,512,512,NULL,?,'deleted',?,?)`)
      .bind(id,owner.id,key,bytes.byteLength,owner.id,createdAt,createdAt).run()

    expect(await cleanupPrivateMedia(env,reference)).toEqual({removed:1,failed:0})
    expect(await env.PRIVATE_BUCKET.get(key)).toBeNull()
    expect(await env.DB.prepare('SELECT id FROM media_assets WHERE id=?').bind(id).first()).toBeNull()
  })
})
