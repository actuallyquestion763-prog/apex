// Application environment validation (Phase 5, Part 2/3). `NODE_ENV` alone
// is not a safe guard — it's just a string a process can be started with,
// and the pre-existing main.ts check only ever *warned* on a suspicious
// production/DATABASE_URL combination, it never refused to boot. This
// module makes misconfiguration a hard startup failure instead of a
// runtime risk, for the specific mistakes that would matter most here:
// running against the wrong database, or booting production without a
// real secret/origin configured.
//
// Wired in as ConfigModule.forRoot({ validate }) in app.module.ts, which
// NestJS calls once at boot, before any module (including PrismaModule)
// finishes initializing — a failure here means the process never starts
// serving traffic, rather than starting and failing requests one at a time.

export type AppEnv = 'development' | 'test' | 'staging' | 'production'

const KNOWN_ENVS: AppEnv[] = ['development', 'test', 'staging', 'production']

// Values that only ever belong in a local/example file, never a real
// deployed secret — booting production with one of these means the actual
// secret was never set, not that it was deliberately chosen.
const PLACEHOLDER_SECRETS = new Set([
  '',
  'REPLACE_WITH_A_LONG_RANDOM_DEV_ONLY_SECRET',
  'CHANGE_ME_PER_ENVIRONMENT',
  'test-only-secret-not-used-outside-automated-tests-do-not-reuse',
])

function isWellFormedPostgresUrl(value: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') return false
  if (!parsed.hostname) return false
  // A database name is the path component (e.g. "/trust_dev") — Prisma
  // requires one; a URL like "postgresql://user:pass@host:5432" with no
  // trailing "/dbname" is well-formed as a URL but not usable by Prisma.
  if (!parsed.pathname || parsed.pathname === '/') return false
  return true
}

export interface ValidatedEnv {
  NODE_ENV: AppEnv
  DATABASE_URL: string
  SESSION_SECRET: string
  FRONTEND_ORIGIN: string
  PORT: string
  SESSION_TTL_HOURS: string
  MARKET_API_KEY: string
}

export function validateEnv(config: Record<string, unknown>): ValidatedEnv {
  const errors: string[] = []

  const rawEnv = String(config.NODE_ENV ?? 'development')
  if (!KNOWN_ENVS.includes(rawEnv as AppEnv)) {
    errors.push(`NODE_ENV must be one of ${KNOWN_ENVS.join(', ')} — got "${rawEnv}".`)
  }
  const env = (KNOWN_ENVS.includes(rawEnv as AppEnv) ? rawEnv : 'development') as AppEnv

  const databaseUrl = String(config.DATABASE_URL ?? '')
  const sessionSecret = String(config.SESSION_SECRET ?? '')
  const frontendOrigin = String(config.FRONTEND_ORIGIN ?? '')

  if (!databaseUrl) {
    errors.push('DATABASE_URL is required.')
  } else if (!isWellFormedPostgresUrl(databaseUrl)) {
    // Phase 6A, Part 4 — a malformed DATABASE_URL previously wasn't
    // distinguished from a missing one; it would instead fail later, deep
    // inside Prisma's connection logic, with a much less obvious error at
    // an unpredictable point in the request lifecycle. Catching it here
    // makes it the same kind of hard, immediate boot-time failure as every
    // other misconfiguration this module checks.
    errors.push(`DATABASE_URL is not a well-formed postgresql:// connection string.`)
  }
  if (!sessionSecret) errors.push('SESSION_SECRET is required.')

  if (env === 'production' || env === 'staging') {
    // Refuse to boot a non-dev environment pointed at what is clearly a
    // local/dev database — this is the hard-failure version of main.ts's
    // pre-existing soft warning.
    const looksLocal = /localhost|127\.0\.0\.1|trust_dev\b|trust_test\b/i.test(databaseUrl)
    if (looksLocal) {
      errors.push(`DATABASE_URL looks like a local/development database, but NODE_ENV=${env}. Refusing to start — this is exactly the "dev DB used by prod" mistake Part 2 exists to prevent.`)
    }
    if (PLACEHOLDER_SECRETS.has(sessionSecret) || sessionSecret.length < 32) {
      errors.push(`SESSION_SECRET must be a real, unique, >=32-character secret in ${env} — a placeholder or short value was found. Generate one with: openssl rand -hex 32`)
    }
    if (!frontendOrigin || /localhost|127\.0\.0\.1/i.test(frontendOrigin)) {
      errors.push(`FRONTEND_ORIGIN must be an explicit, real origin in ${env} — got "${frontendOrigin || '(unset)'}". A missing/localhost value here would either break CORS or silently widen it (Part 18).`)
    }
    if (!frontendOrigin.startsWith('https://')) {
      errors.push(`FRONTEND_ORIGIN must be an https:// origin in ${env} (Part 16/18 — cookies are Secure-flagged and CORS credentials require it).`)
    }
  }

  if (env === 'development' || env === 'test') {
    // The inverse mistake: a dev/test process must never be pointed at
    // something that looks like a real deployed database.
    if (/prod/i.test(databaseUrl)) {
      errors.push(`DATABASE_URL looks like a production database, but NODE_ENV=${env}. Refusing to start — this is the "prod DB touched by a dev command" mistake Part 2 exists to prevent.`)
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n  - ${errors.join('\n  - ')}`)
  }

  return {
    NODE_ENV: env,
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: sessionSecret,
    FRONTEND_ORIGIN: frontendOrigin || 'http://localhost:5173',
    PORT: String(config.PORT ?? '4100'),
    SESSION_TTL_HOURS: String(config.SESSION_TTL_HOURS ?? '24'),
    MARKET_API_KEY: String(config.MARKET_API_KEY ?? ''),
  }
}
