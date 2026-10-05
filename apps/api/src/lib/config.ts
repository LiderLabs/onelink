import {
  DEFAULT_PBKDF2_ITERATIONS,
  MAX_SUPPORTED_ITERATIONS,
  MIN_ACCEPTED_ITERATIONS,
} from './crypto'
import { AppError } from './errors'

// ============================================================================
// Runtime configuration derived from bindings/secrets/vars.
//
// Read through this once per request rather than scattering `env.X` reads
// around the codebase — it is where "is this deployment actually configured?"
// gets answered, loudly, instead of silently degrading to a weak default.
// ============================================================================

const DEV_PEPPER_FALLBACK = 'onelink-dev-pepper-do-not-use-in-production'
const MIN_PEPPER_LENGTH = 16

/**
 * The only values `ENVIRONMENT` is allowed to take.
 *
 * An allow-list rather than a `=== 'production'` comparison: a typo (`prod`), a
 * missing var, or a half-configured deployment must NOT be read as "not
 * production", because that path is the one that accepts the development
 * pepper and hands out dev affordances (reset tokens in response bodies).
 * Unrecognised values fail closed instead.
 */
const ENVIRONMENTS = ['development', 'test', 'production'] as const
type Environment = (typeof ENVIRONMENTS)[number]

export interface AppConfig {
  environment: Environment
  isProduction: boolean
  isTest: boolean
  /**
   * Whether a response may carry something that only exists because no mail
   * provider is wired up (currently: echoing a password-reset token back).
   * True everywhere except production — see ENVIRONMENTS above.
   */
  allowDevTokens: boolean
  appOrigin: string
  sessionPepper: string
  pbkdf2Iterations: number
}

function parseEnvironment(raw: unknown): Environment {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (!(ENVIRONMENTS as readonly string[]).includes(value)) {
    throw new AppError(
      500,
      'INTERNAL',
      `ENVIRONMENT must be one of ${ENVIRONMENTS.join(', ')} (received ${
        value.length > 0 ? `"${value}"` : 'nothing'
      }).`,
    )
  }
  return value as Environment
}

/**
 * Environments that are allowed to unlock development affordances.
 *
 * Derived from ENVIRONMENTS rather than written out, so an environment added
 * there in future is production-like until someone explicitly exempts it here.
 */
const NON_PRODUCTION_ENVIRONMENTS: readonly string[] = ENVIRONMENTS.filter(
  (value) => value !== 'production',
)

/**
 * Non-throwing production check, for code that cannot fail a request — notably
 * the CORS middleware, which runs before any handler and on every request.
 *
 * Anything that is not an explicitly recognised NON-production value counts as
 * production, so a typo (`prod`, an empty string) fails closed instead of
 * quietly enabling dev behaviour.
 */
export function isProductionEnvironment(env: Cloudflare.Env): boolean {
  const value = String(env.ENVIRONMENT ?? '')
    .trim()
    .toLowerCase()
  return !NON_PRODUCTION_ENVIRONMENTS.includes(value)
}

export function appConfig(env: Cloudflare.Env): AppConfig {
  const environment = parseEnvironment(env.ENVIRONMENT)
  const isProduction = environment === 'production'

  const pepper = typeof env.SESSION_PEPPER === 'string' ? env.SESSION_PEPPER.trim() : ''
  if (isProduction && pepper.length < MIN_PEPPER_LENGTH) {
    // Fail closed: a missing pepper would silently weaken every token hash.
    throw new AppError(
      500,
      'INTERNAL',
      `SESSION_PEPPER must be set to at least ${MIN_PEPPER_LENGTH} characters in production.`,
    )
  }

  const override = Number.parseInt(String(env.PBKDF2_ITERATIONS ?? ''), 10)
  // Clamped on BOTH sides so the configured cost is always one this runtime
  // will actually accept:
  //
  //   * above MAX_SUPPORTED_ITERATIONS, `crypto.subtle.deriveBits` throws
  //     `NotSupportedError`, which would 500 every login instead of merely being
  //     weaker than the OWASP figure suggests;
  //   * below MIN_ACCEPTED_ITERATIONS we would mint hashes that the verifier
  //     refuses to accept, i.e. an account locked out by its own configuration.
  const pbkdf2Iterations = Number.isFinite(override)
    ? Math.min(Math.max(override, MIN_ACCEPTED_ITERATIONS), MAX_SUPPORTED_ITERATIONS)
    : DEFAULT_PBKDF2_ITERATIONS

  return {
    environment,
    isProduction,
    isTest: environment === 'test',
    allowDevTokens: !isProduction,
    appOrigin: typeof env.APP_ORIGIN === 'string' ? env.APP_ORIGIN : '',
    sessionPepper: pepper.length > 0 ? pepper : DEV_PEPPER_FALLBACK,
    pbkdf2Iterations,
  }
}
