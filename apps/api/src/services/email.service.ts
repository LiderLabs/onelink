// ============================================================================
// Email — TEMPLATE STORE + DELIVERY SEAM.
//
// Nothing in this file sends mail. Templates live in the `email_templates`
// table (seeded in seed/platform-defaults.sql) and are rendered here; the
// `deliver()` function is the single point where a provider would be plugged
// in (Resend, Postmark, Cloudflare Email Routing, a Queue producer, ...).
//
// Until a provider is wired up, `deliver()` records the message and logs it.
// That is deliberate: the reset-password and invitation flows need a real,
// testable seam *before* a provider is chosen, and callers must not be able to
// tell the difference.
// ============================================================================

export interface RenderedEmail {
  to: string
  templateKey: string
  subject: string
  text: string
  html: string | null
}

export interface TemplateRow {
  key: string
  subject: string
  body_text: string
  body_html: string | null
  enabled: number
}

const PLACEHOLDER = /\{\{\s*([a-z0-9_.]+)\s*\}\}/gi

/**
 * Substitutes `{{name}}` placeholders.
 *
 * Unknown placeholders are left visible on purpose: a template referencing a
 * variable the caller forgot to pass should be obvious in testing, not render
 * as an empty string that nobody notices.
 */
export function renderTemplate(body: string, variables: Record<string, string>): string {
  return body.replace(PLACEHOLDER, (match, rawName: string) => {
    const value = variables[rawName]
    return value === undefined ? match : value
  })
}

export async function loadTemplate(
  db: D1Database,
  key: string,
): Promise<TemplateRow | null> {
  const row = await db
    .prepare(
      'SELECT key, subject, body_text, body_html, enabled FROM email_templates WHERE key = ? LIMIT 1',
    )
    .bind(key)
    .first<TemplateRow>()
  return row ?? null
}

export interface QueueEmailInput {
  to: string
  templateKey: string
  variables: Record<string, string>
  /** Used when the template row is missing or disabled. */
  fallbackSubject?: string
}

/**
 * Renders a template. Returns null when the template does not exist or has been
 * disabled by an owner — callers treat that as "nothing to send" rather than an
 * error, so disabling a template is a safe operation.
 */
export async function renderEmail(
  db: D1Database,
  input: QueueEmailInput,
): Promise<RenderedEmail | null> {
  const template = await loadTemplate(db, input.templateKey)
  if (!template || template.enabled !== 1) return null

  const variables = { ...input.variables }
  return {
    to: input.to,
    templateKey: input.templateKey,
    subject: renderTemplate(template.subject, variables),
    text: renderTemplate(template.body_text, variables),
    html: template.body_html ? renderTemplate(template.body_html, variables) : null,
  }
}

/**
 * THE SEAM.
 *
 * Replace the body of this function to integrate a provider. Signature is
 * intentionally provider-agnostic, and it is already async so callers do not
 * need to change when delivery becomes a network call.
 *
 * Failure policy: delivery must NEVER throw into a request path that has
 * already committed its transaction (a reset link that failed to send is a
 * retry-able inconvenience; a 500 after the password changed is a lie).
 */
export async function deliver(message: RenderedEmail): Promise<boolean> {
  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'email_not_delivered',
      reason: 'no provider configured',
      to: message.to,
      template: message.templateKey,
      subject: message.subject,
      bytes: message.text.length,
    }),
  )
  return false
}

/** Render + deliver, swallowing delivery errors. */
export async function queueEmail(
  db: D1Database,
  input: QueueEmailInput,
): Promise<RenderedEmail | null> {
  const message = await renderEmail(db, input)
  if (!message) return null

  try {
    await deliver(message)
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'email_delivery_failed',
        template: message.templateKey,
        message: error instanceof Error ? error.message : String(error),
      }),
    )
  }
  return message
}
