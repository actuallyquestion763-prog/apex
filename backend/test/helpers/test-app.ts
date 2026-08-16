import { Test } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import cookieParser from 'cookie-parser'
import * as argon2 from 'argon2'
import { AppModule } from '../../src/app.module'
import { PrismaService } from '../../src/prisma/prisma.service'
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter'
import { generateTotpSecret, generateTotpCode } from '../../src/auth/totp.util'
import type { Role } from '@prisma/client'

// Builds a real Nest application (all real modules/guards/pipes/filters,
// same as production main.ts) wired to whatever DATABASE_URL is in the
// environment — see test/setup-env.ts, which points it at the real
// PostgreSQL instance started by scripts/test-db.js.
export async function createTestApp(): Promise<{ app: INestApplication; prisma: PrismaService }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  const app = moduleRef.createNestApplication()
  app.use(cookieParser())
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
  opts: { email: string; password: string; role?: Role; fullName?: string },
) {
  const passwordHash = await argon2.hash(opts.password)
  const user = await prisma.user.create({
    data: {
      email: opts.email.toLowerCase(),
      passwordHash,
      fullName: opts.fullName ?? 'Test User',
      role: opts.role ?? 'USER',
      status: 'ACTIVE',
      kycStatus: 'VERIFIED',
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
