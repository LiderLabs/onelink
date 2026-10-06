import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { cleanupAvatarMedia } from '../src/services/media-maintenance.service'
import { uploadAvatar } from '../src/services/media.service'
import { standaloneEntry } from '../src/services/audit.service'
import { createTestUser, resetIsolateCaches } from './helpers'
import { avatarWebp } from './fixtures/media'
import type { Auditor, MediaDto } from '../src/types'

beforeEach(resetIsolateCaches)
function audit():Auditor {return {handled:true,entries:[],claim:draft=>standaloneEntry(draft)}}
async function seed(count=1):Promise<{userId:string;assets:MediaDto[]}>{
  const user=await createTestUser(), assets:MediaDto[]=[]
  for(let i=0;i<count;i++)assets.push(await uploadAvatar(env,{id:user.id,role:user.role,label:user.username},avatarWebp(),'image/webp',audit()))
  return {userId:user.id,assets}
}
describe('avatar maintenance',()=>{
  it('cleans old unattached and marked assets but protects attached and recent assets',async()=>{
    const {userId,assets}=await seed(4), reference=Date.now()
    await env.DB.prepare('UPDATE media_assets SET created_at=? WHERE id IN (?,?)').bind(reference-86400001,assets[0]!.id,assets[1]!.id).run()
    await env.DB.prepare('UPDATE users SET avatar_key=? WHERE id=?').bind(assets[0]!.key,userId).run()
    await env.DB.prepare("UPDATE media_assets SET status='deleted' WHERE id=?").bind(assets[3]!.id).run()
    expect(await cleanupAvatarMedia(env,reference)).toEqual({removed:2,failed:0})
    for(const index of [0,2])expect(await env.PUBLIC_BUCKET.get(assets[index]!.key)).not.toBeNull()
    for(const index of [1,3])expect(await env.PUBLIC_BUCKET.get(assets[index]!.key)).toBeNull()
  })
  it('processes at most 100 candidates',async()=>{
    await seed(101);await env.DB.prepare("UPDATE media_assets SET status='deleted'").run()
    expect(await cleanupAvatarMedia(env)).toEqual({removed:100,failed:0})
    expect((await env.DB.prepare('SELECT count(*) AS n FROM media_assets').first<{n:number}>())?.n).toBe(1)
  })
  it('continues after a storage failure and retains its tracked tombstone',async()=>{
    const {assets}=await seed(2);await env.DB.prepare("UPDATE media_assets SET status='deleted'").run()
    const failedBucket=new Proxy(env.PUBLIC_BUCKET,{get(target,key){if(key==='delete')return async(objectKey:string)=>{if(objectKey===assets[0]!.key)throw new Error('storage failure');return target.delete(objectKey)};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}})
    const log=vi.spyOn(console,'error').mockImplementation(()=>{})
    try {expect(await cleanupAvatarMedia({...env,PUBLIC_BUCKET:failedBucket})).toEqual({removed:1,failed:1})}finally{log.mockRestore()}
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
    expect(await cleanupAvatarMedia({...env,DB:racedDb},reference)).toEqual({removed:0,failed:0})
    expect(await env.PUBLIC_BUCKET.get(assets[0]!.key)).not.toBeNull()
  })
})
