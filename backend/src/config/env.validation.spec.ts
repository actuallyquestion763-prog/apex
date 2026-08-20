import { validateEnv } from './env.validation'

const validDev = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://trust_app:x@localhost:5432/trust_dev?schema=public',
  SESSION_SECRET: 'dev-secret',
  FRONTEND_ORIGIN: 'http://localhost:5173',
}

const validProd = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://trust_app:realpassword@db.internal:5432/trust_prod?schema=public',
  SESSION_SECRET: 'a'.repeat(48),
  FRONTEND_ORIGIN: 'https://app.example.com',
}

describe('validateEnv', () => {
  it('accepts a valid development configuration', () => {
    expect(() => validateEnv(validDev)).not.toThrow()
  })

  it('accepts a valid production configuration', () => {
    expect(() => validateEnv(validProd)).not.toThrow()
  })

  // Part 31, item 1: production refuses insecure configuration.
  it('refuses production with a localhost/dev-shaped DATABASE_URL', () => {
    expect(() => validateEnv({ ...validProd, DATABASE_URL: 'postgresql://trust_app:x@localhost:5432/trust_dev' })).toThrow(/local\/development database/)
  })

  it('refuses production with a placeholder/short SESSION_SECRET', () => {
    expect(() => validateEnv({ ...validProd, SESSION_SECRET: 'REPLACE_WITH_A_LONG_RANDOM_DEV_ONLY_SECRET' })).toThrow(/SESSION_SECRET/)
    expect(() => validateEnv({ ...validProd, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/)
  })

  it('refuses production with a missing or localhost FRONTEND_ORIGIN', () => {
    expect(() => validateEnv({ ...validProd, FRONTEND_ORIGIN: '' })).toThrow(/FRONTEND_ORIGIN/)
    expect(() => validateEnv({ ...validProd, FRONTEND_ORIGIN: 'http://localhost:5173' })).toThrow(/FRONTEND_ORIGIN/)
  })

  it('refuses production with a non-https FRONTEND_ORIGIN', () => {
    expect(() => validateEnv({ ...validProd, FRONTEND_ORIGIN: 'http://app.example.com' })).toThrow(/https/)
  })

  // Part 31, item 2: development cannot accidentally use production configuration.
  it('refuses development pointed at what looks like a production DATABASE_URL', () => {
    expect(() => validateEnv({ ...validDev, DATABASE_URL: 'postgresql://trust_app:x@db.internal:5432/trust_prod' })).toThrow(/production database/)
  })

  it('refuses an unrecognized NODE_ENV value', () => {
    expect(() => validateEnv({ ...validDev, NODE_ENV: 'production-ish' })).toThrow(/NODE_ENV must be one of/)
  })

  it('staging is held to the same standard as production', () => {
    expect(() => validateEnv({ ...validProd, NODE_ENV: 'staging', DATABASE_URL: 'postgresql://trust_app:x@localhost:5432/trust_dev' })).toThrow(/local\/development database/)
  })

  // ---- Phase 6A, Part 21 — explicit numbered test list ----------------------

  it('1. production cannot use a localhost database', () => {
    expect(() => validateEnv({ ...validProd, DATABASE_URL: 'postgresql://trust_app:x@localhost:5432/anything' })).toThrow(/local\/development database/)
    expect(() => validateEnv({ ...validProd, DATABASE_URL: 'postgresql://trust_app:x@127.0.0.1:5432/anything' })).toThrow(/local\/development database/)
  })

  it('2. production cannot use trust_dev', () => {
    expect(() => validateEnv({ ...validProd, DATABASE_URL: 'postgresql://trust_app:x@db.internal:5432/trust_dev' })).toThrow(/local\/development database/)
  })

  it('3. production cannot use trust_test', () => {
    expect(() => validateEnv({ ...validProd, DATABASE_URL: 'postgresql://trust_app:x@db.internal:5432/trust_test' })).toThrow(/local\/development database/)
  })

  it('4. staging cannot use a production-shaped database (i.e. staging is held to the SAME anti-local standard, not a weaker one)', () => {
    expect(() => validateEnv({ ...validProd, NODE_ENV: 'staging', DATABASE_URL: 'postgresql://trust_app:x@localhost:5432/trust_dev' })).toThrow(/local\/development database/)
  })

  it('5. development cannot use a production-shaped database', () => {
    expect(() => validateEnv({ ...validDev, DATABASE_URL: 'postgresql://trust_app:x@prod-db.internal:5432/trust_prod' })).toThrow(/production database/)
  })

  it('6. missing production DATABASE_URL fails', () => {
    expect(() => validateEnv({ ...validProd, DATABASE_URL: '' })).toThrow(/DATABASE_URL is required/)
    expect(() => validateEnv({ ...validProd, DATABASE_URL: undefined })).toThrow(/DATABASE_URL is required/)
  })

  it('7. missing production SESSION_SECRET fails', () => {
    expect(() => validateEnv({ ...validProd, SESSION_SECRET: '' })).toThrow(/SESSION_SECRET is required/)
    expect(() => validateEnv({ ...validProd, SESSION_SECRET: undefined })).toThrow(/SESSION_SECRET is required/)
  })

  it('8. missing production FRONTEND_ORIGIN fails', () => {
    expect(() => validateEnv({ ...validProd, FRONTEND_ORIGIN: undefined })).toThrow(/FRONTEND_ORIGIN/)
  })

  // Phase 6A, Part 4 — malformed DATABASE_URL is now distinguished from a
  // missing one, and caught at boot rather than failing deep inside Prisma.
  it('rejects a malformed DATABASE_URL (not a parseable postgresql:// URL) in every environment', () => {
    expect(() => validateEnv({ ...validDev, DATABASE_URL: 'not-a-url-at-all' })).toThrow(/well-formed/)
    expect(() => validateEnv({ ...validDev, DATABASE_URL: 'mysql://user:pass@localhost:3306/trust_dev' })).toThrow(/well-formed/)
    expect(() => validateEnv({ ...validProd, DATABASE_URL: 'postgresql://db.internal:5432' })).toThrow(/well-formed/) // no database name
  })

  it('accepts both postgresql:// and postgres:// schemes', () => {
    expect(() => validateEnv({ ...validDev, DATABASE_URL: 'postgres://trust_app:x@localhost:5432/trust_dev' })).not.toThrow()
  })
})
