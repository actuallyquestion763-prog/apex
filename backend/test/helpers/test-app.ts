import { randomUUID } from 'crypto'
import { Test } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import type { Request, Response, NextFunction } from 'express'
import cookieParser from 'cookie-parser'
import * as argon2 from 'argon2'
import { AppModule } from '../../src/app.module'
import { PrismaService } from '../../src/prisma/prisma.service'
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter'
import { LoggingInterceptor } from '../../src/common/interceptors/logging.interceptor'
import { generateTotpSecret, generateTotpCode } from '../../src/auth/totp.util'
import { generateReferralCode } from '../../src/auth/referral-code.util'
import { resolveCorsOrigin } from '../../src/config/security-config'
import type { Role } from '@prisma/client'

// Builds a real Nest application (all real modules/guards/pipes/filters,
// same as production main.ts) wired to whatever DATABASE_URL is in the
// environment — see test/setup-env.ts, which points it at the real
// PostgreSQL instance started by scripts/test-db.js.
export async function createTestApp(): Promise<{ app: INestApplication; prisma: PrismaService }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  const app = moduleRef.createNestApplication()
  app.use(cookieParser())
  // Mirrors main.ts's request-id + structured logging wiring (Checkpoint
  // I.1, Part 5) so e2e tests exercise the exact same middleware/interceptor
  // real traffic goes through, not a divergent test-only setup.
  app.use((req: Request, res: Response, next: NextFunction) => {
    ;(req as Request & { requestId?: string }).requestId = randomUUID()
    res.setHeader('X-Request-Id', (req as Request & { requestId?: string }).requestId!)
    next()
  })
  app.useGlobalInterceptors(new LoggingInterceptor())
  // Mirrors main.ts's real CORS setup (Phase 5, Part 18) so
  // production-config.e2e-spec.ts can verify actual `cors` package
  // behavior, not just the pure resolveCorsOrigin() function in isolation.
  app.enableCors({ origin: resolveCorsOrigin(process.env.NODE_ENV ?? 'test', process.env.FRONTEND_ORIGIN), credentials: true })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  app.useGlobalFilters(new AllExceptionsFilter())
  await app.init()
  const prisma = app.get(PrismaService)
  return { app, prisma }
}

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
}

// Creates a user directly via Prisma, bypassing the public registration API
// — this is how ADMIN/SUPER_ADMIN test fixtures are created, mirroring how
// the real system actually works: there is no self-service "become admin"
// endpoint, roles above USER are only ever assigned out of band (the seed
// script, or an existing SUPER_ADMIN).
export async function createUserDirect(
  prisma: PrismaService,
  opts: { email: string; password: string; role?: Role; fullName?: string; kycStatus?: 'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED' },
) {
  const passwordHash = await argon2.hash(opts.password)
  const user = await prisma.user.create({
    data: {
      email: opts.email.toLowerCase(),
      passwordHash,
      fullName: opts.fullName ?? 'Test User',
      role: opts.role ?? 'USER',
      status: 'ACTIVE',
      // Defaults to VERIFIED — most fixtures need a user unblocked by KYC
      // gating for unrelated financial/trading tests. KYC-specific tests
      // (kyc.e2e-spec.ts) explicitly override this to NOT_STARTED.
      kycStatus: opts.kycStatus ?? 'VERIFIED',
      referralCode: generateReferralCode(),
    },
  })
  const account = await prisma.account.create({ data: { userId: user.id } })
  return { user, account }
}

// Enables real TOTP 2FA for a test user directly (equivalent to the
// setup+confirm flow, done via Prisma so tests can get straight to
// exercising the step-up-authorization logic).
export async function enableTotpDirect(prisma: PrismaService, userId: string): Promise<string> {
  const secret = generateTotpSecret()
  await prisma.twoFactorCredential.upsert({
    where: { userId },
    create: { userId, secret, enabled: true },
    update: { secret, enabled: true },
  })
  await prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } })
  return secret
}

export function currentTotpCode(secret: string): string {
  return generateTotpCode(secret)
}

// Grants a fine-grained permission directly via Prisma — bypasses the real
// PATCH /admin/admins/:id/permissions/:permission/grant endpoint (already
// covered by authorization.e2e-spec.ts) so CMS/Support tests can set up an
// ADMIN with exactly the one permission they're testing, without needing a
// second SUPER_ADMIN + step-up dance in every test file.
export async function grantPermissionDirect(prisma: PrismaService, userId: string, permissionKey: string): Promise<void> {
  const permission = await prisma.permission.findUniqueOrThrow({ where: { key: permissionKey } })
  await prisma.userPermission.upsert({
    where: { userId_permissionId: { userId, permissionId: permission.id } },
    create: { userId, permissionId: permission.id },
    update: {},
  })
}

export function extractSessionCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'] as string[] | string | undefined
  if (!raw) throw new Error('Response did not set a cookie.')
  const cookieStr = Array.isArray(raw) ? raw.find((c) => c.startsWith('trust_session=')) : raw
  if (!cookieStr) throw new Error('trust_session cookie not found in response.')
  return cookieStr.split(';')[0]
}

export function fullSetCookieHeader(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'] as string[] | string | undefined
  if (!raw) throw new Error('Response did not set a cookie.')
  return Array.isArray(raw) ? (raw.find((c) => c.startsWith('trust_session=')) ?? '') : raw
}
