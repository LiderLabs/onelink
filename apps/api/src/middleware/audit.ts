import { createMiddleware } from 'hono/factory'
import { auditInsertStmt, createAuditor } from '../services/audit.service'
import { isAppError } from '../lib/errors'
import type { AppEnv, AuditStatus } from '../types'

// ============================================================================
// Audit middleware.
//
// Installs the request-scoped `Auditor` (see services/audit.service.ts) and
// then acts as a SAFETY NET: if a state-changing request never called
// `auditor.claim()`, a generic entry is written so that no mutation can happen
// without leaving a trace — including ones that failed halfway.
//
// Because it only fires when `handled === false`, it can never duplicate the
// rich entry a service already wrote.
// ============================================================================

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function isMutationMethod(method: string): boolean {
  return MUTATION_METHODS.has(method.toUpperCase())
}

function statusForResponse(status: number): AuditStatus {
  if (status >= 500) return 'failure'
  if (status >= 400) return 'denied'
  return 'success'
}

function statusForError(error: unknown): AuditStatus {
  if (isAppError(error)) {
    if (error.status >= 500) return 'failure'
    if (error.status >= 400) return 'denied'
    return 'success'
  }
  return 'failure'
}

export const auditMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const auditor = createAuditor(c, c.get('requestId'))
  c.set('auditor', auditor)

  let failure: unknown = null
  try {
    await next()
  } catch (error) {
    // Hono does not swallow handler errors inside `next()`, so the post-flight
    // audit below has to run on the way out via this catch + rethrow.
    failure = error
  }

  const user = c.get('user')
  if (user && isMutationMethod(c.req.method) && !auditor.handled) {
    const status = failure ? statusForError(failure) : statusForResponse(c.res.status)
    const entry = auditor.claim({
      action: `http.${c.req.method.toLowerCase()}`,
      status,
      metadata: {
        path: c.req.path,
        status: failure ? undefined : c.res.status,
        fallback: true,
      },
    })

    try {
      await auditInsertStmt(c.env.DB, entry).run()
    } catch (writeError) {
      // Never let an audit-write failure mask the original error.
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'audit_fallback_write_failed',
          requestId: c.get('requestId'),
          path: c.req.path,
          message: writeError instanceof Error ? writeError.message : String(writeError),
        }),
      )
    }
  }

  if (failure) throw failure
})
