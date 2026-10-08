import { now } from '../lib/clock'
import { conflict, notFound } from '../lib/errors'
import { sha256HexOfBytes } from '../lib/crypto'
import { ulid } from '../lib/ids'
import { extensionForMime } from '../lib/image'
import { assertStorableImage } from './media.service'
import { auditInsertStmt } from './audit.service'
import type { ActorInfo, Auditor } from '../types'

export type EvidenceCase = 'report' | 'appeal'

function caseTable(caseType: EvidenceCase): 'reports' | 'appeals' {
  return caseType === 'report' ? 'reports' : 'appeals'
}

function evidenceKind(caseType: EvidenceCase): 'report_evidence' | 'appeal_evidence' {
  return caseType === 'report' ? 'report_evidence' : 'appeal_evidence'
}

export async function uploadPrivateEvidence(
  env: Cloudflare.Env,
  caseType: EvidenceCase,
  caseId: string,
  actor: ActorInfo,
  bytes: Uint8Array,
  declaredType: string | null,
  auditor: Auditor,
): Promise<{ id: string; mime: string; bytes: number }> {
  const table = caseTable(caseType)
  const target = caseType === 'report'
    ? await env.DB.prepare('SELECT id,page_id,evidence_key,status FROM reports WHERE id=? LIMIT 1')
      .bind(caseId).first<{ id: string; page_id: string | null; evidence_key: string | null; status: string }>()
    : await env.DB.prepare('SELECT id,evidence_key,status FROM appeals WHERE id=? LIMIT 1')
      .bind(caseId).first<{ id: string; page_id?: null; evidence_key: string | null; status: string }>()
  if (!target) throw notFound(caseType === 'report' ? 'Report' : 'Appeal')
  if (caseType === 'appeal' && target.status !== 'pending') throw conflict('Evidence can only be attached to a pending appeal.')
  if (caseType === 'report' && target.status !== 'open' && target.status !== 'reviewing') {
    throw conflict('Evidence can only be attached to an active report.')
  }
  if (target.evidence_key) throw conflict('Evidence is already attached to this case.')

  const image = assertStorableImage({ kind: 'avatar', filename: null, bytes, declaredType })
  const id = ulid()
  const timestamp = now()
  const kind = evidenceKind(caseType)
  const key = `${kind}/${caseId}/${id}.${extensionForMime(image.mime)}`
  const checksum = await sha256HexOfBytes(bytes)
  const entry = auditor.claim({ action: 'media.upload', targetType: 'media', targetId: id,
    actorUserId: actor.id, actorRole: actor.role, actorLabel: actor.label,
    metadata: { kind, bucket: 'private', caseType, caseId, bytes: bytes.byteLength, mime: image.mime } })

  await env.DB.prepare(`INSERT INTO media_assets(
    id,owner_user_id,page_id,r2_key,bucket,kind,mime,size_bytes,width,height,checksum,uploaded_by,status,created_at,deleted_at
  ) VALUES(?,?,?,?, 'private',?,?,?,?,?,?,?,'deleted',?,?)`)
    .bind(id, actor.id, target.page_id ?? null, key, kind, image.mime, bytes.byteLength, image.width, image.height,
      checksum, actor.id, timestamp, timestamp).run()

  try {
    await env.PRIVATE_BUCKET.put(key, bytes, {
      httpMetadata: { contentType: image.mime, cacheControl: 'private, no-store' },
    })
    const attach = env.DB.prepare(`UPDATE ${table} SET evidence_key=? WHERE id=? AND evidence_key IS NULL`)
      .bind(key, caseId)
    const activate = env.DB.prepare(`UPDATE media_assets SET status='active',deleted_at=NULL
      WHERE id=? AND status='deleted' AND changes()=1`).bind(id)
    const results = await env.DB.batch([attach, activate, auditInsertStmt(env.DB, entry, true)])
    if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
      throw conflict('Evidence could not be attached to this case.')
    }
    return { id, mime: image.mime, bytes: bytes.byteLength }
  } catch (error) {
    try {
      await env.PRIVATE_BUCKET.delete(key)
      await env.DB.prepare("DELETE FROM media_assets WHERE id=? AND status='deleted'").bind(id).run()
    } catch (cleanupError) {
      console.error(JSON.stringify({ level: 'error', msg: 'private_evidence_cleanup_deferred', key,
        requestId: entry.requestId,
        message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) }))
    }
    throw error
  }
}

export async function readPrivateEvidence(
  env: Cloudflare.Env,
  caseType: EvidenceCase,
  caseId: string,
): Promise<R2ObjectBody> {
  const table = caseTable(caseType)
  const row = await env.DB.prepare(`SELECT m.r2_key,m.mime FROM ${table} c
    JOIN media_assets m ON m.r2_key=c.evidence_key
    WHERE c.id=? AND m.bucket='private' AND m.kind=? AND m.status='active' LIMIT 1`)
    .bind(caseId, evidenceKind(caseType)).first<{ r2_key: string; mime: string }>()
  if (!row) throw notFound('Evidence')
  const object = await env.PRIVATE_BUCKET.get(row.r2_key)
  if (!object) throw notFound('Evidence')
  return object
}