import type { INestApplication } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { runBootstrap, type BootstrapIO, type BootstrapResult } from '../scripts/create-superadmin'
import { createTestApp, uniqueEmail, createUserDirect, extractSessionCookie, enableTotpDirect, currentTotpCode } from './helpers/test-app'
import type { PrismaService } from '../src/prisma/prisma.service'

// Drives runBootstrap() exactly like the real interactive script does, but
// from a fixed, in-memory answer script instead of a real TTY — proves
// there is no TOTP/authenticator prompt anywhere in the flow, since a code
// would have to be the 5th answer and none is ever supplied here.
function scriptedIO(answers: string[]): BootstrapIO & { logs: string[]; errors: string[] } {
  let i = 0
  const logs: string[] = []
  const errors: string[] = []
  const next = async () => {
    if (i >= answers.length) throw new Error(`runBootstrap asked a question beyond the scripted ${answers.length} answers — an extra prompt (e.g. TOTP) may have been reintroduced.`)
    return answers[i++]
  }
  return {
    ask: next,
    askHidden: next,
    log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
    error: (...args: unknown[]) => errors.push(args.map(String).join(' ')),
    logs,
    errors,
  }
}

// A minimal, fully in-memory stand-in for PrismaClient covering only the
// calls runBootstrap actually makes. Deliberately does NOT implement
// `twoFactorCredential` on the transaction client at all — if a future
// regression reintroduces a TOTP secret write, this throws immediately
// ("tx.twoFactorCredential is not a function") instead of silently letting
// one slip back in. Real Postgres (via createTestApp) is used separately
// below for the tests that need genuine end-to-end HTTP/login behavior.
interface FakeUser {
  id: string
  email: string
  role: string
  passwordHash: string
  fullName: string
  twoFactorEnabled: boolean
  [key: string]: unknown
}

function createFakePrisma(seedUsers: FakeUser[] = []) {
  const users: FakeUser[] = [...seedUsers]
  const accounts: { userId: string }[] = []
  let nextId = 1
  let countCalls = 0

  const tx = {
    user: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const user = { id: `fake-user-${nextId++}`, ...data } as FakeUser
        users.push(user)
        return user
      },
    },
    account: {
      create: async ({ data }: { data: { userId: string } }) => {
        accounts.push(data)
        return { id: `fake-account-${nextId++}`, ...data }
      },
    },
  }
  type Tx = typeof tx

  const fakePrisma = {
    user: {
      count: async ({ where }: { where: { role: string } }) => {
        countCalls += 1
        return users.filter((u) => u.role === where.role).length
      },
      findUnique: async ({ where }: { where: { email: string } }) => users.find((u) => u.email === where.email) ?? null,
    },
    $transaction: async (fn: (txArg: Tx) => Promise<unknown>) => fn(tx),
  }

  return { prisma: fakePrisma as unknown as PrismaClient, users, accounts, countCallCount: () => countCalls }
}

describe('Super Admin bootstrap — TOTP removed from account creation (fake in-memory Prisma)', () => {
  it('creates a Super Admin from email + password alone — the answer script never supplies a 6th (TOTP) answer', async () => {
    const { prisma, users } = createFakePrisma()
    const email = uniqueEmail('bootstrap-nofa')
    const io = scriptedIO([email, 'Bootstrap Admin', 'a-strong-bootstrap-password', 'a-strong-bootstrap-password'])

    const result: BootstrapResult = await runBootstrap(prisma, io)

    expect(result.ok).toBe(true)
    expect(result.userId).toBeDefined()
    expect(users).toHaveLength(1)
    expect(users[0].email).toBe(email)
    expect(users[0].role).toBe('SUPER_ADMIN')
  })

  it('never mentions an authenticator, TOTP code, or otpauth:// URL anywhere in its output', async () => {
    const { prisma } = createFakePrisma()
    const email = uniqueEmail('bootstrap-nomsg')
    const io = scriptedIO([email, 'Bootstrap Admin', 'a-strong-bootstrap-password', 'a-strong-bootstrap-password'])

    await runBootstrap(prisma, io)

    const allOutput = [...io.logs, ...io.errors].join('\n')
    expect(allOutput).not.toMatch(/authenticator|6-digit|TOTP|otpauth/i)
  })

  it('the created account has twoFactorEnabled=false and no TOTP secret is ever generated or written', async () => {
    const { prisma, users } = createFakePrisma()
    const email = uniqueEmail('bootstrap-secretcheck')
    const io = scriptedIO([email, 'Bootstrap Admin', 'a-strong-bootstrap-password', 'a-strong-bootstrap-password'])

    // If runBootstrap tried to write a TwoFactorCredential, the fake tx
    // (which has no `twoFactorCredential` property) would throw here.
    const result = await runBootstrap(prisma, io)

    expect(result.ok).toBe(true)
    expect(users[0].twoFactorEnabled).toBe(false)
    expect(users[0]).not.toHaveProperty('secret')
  })

  it('still refuses when a SUPER_ADMIN already exists (creation protection preserved)', async () => {
    const { prisma, users } = createFakePrisma([
      { id: 'existing-1', email: 'existing-super@example.com', role: 'SUPER_ADMIN', passwordHash: 'x', fullName: 'Existing', twoFactorEnabled: false },
    ])
    const io = scriptedIO([]) // should never even reach a question

    const result = await runBootstrap(prisma, io)

    expect(result).toEqual({ ok: false, reason: 'already_exists' })
    expect(users).toHaveLength(1) // nothing new was created
  })

  it('still refuses on the pre-write race re-check if a SUPER_ADMIN appears mid-flow', async () => {
    const { prisma, users } = createFakePrisma()
    // Simulate a concurrent bootstrap winning the race between the initial
    // check and the pre-write re-check, exactly like the real race guard is
    // meant to catch — untouched by this change, still exercised here.
    let calls = 0
    ;(prisma as any).user.count = async () => {
      calls += 1
      return calls === 1 ? 0 : 1 // initial check: none yet; re-check: someone else won the race
    }

    const email = uniqueEmail('bootstrap-race')
    const io = scriptedIO([email, 'Bootstrap Admin', 'a-strong-bootstrap-password', 'a-strong-bootstrap-password'])
    const result = await runBootstrap(prisma, io)

    expect(result).toEqual({ ok: false, reason: 'race_lost' })
    expect(users).toHaveLength(0)
  })
})

describe('Super Admin bootstrap — 2FA behavior elsewhere is unaffected (real PostgreSQL)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let server: any

  beforeAll(async () => {
    const t = await createTestApp()
    app = t.app
    prisma = t.prisma
    server = app.getHttpServer()
  })

  afterAll(async () => {
    await app.close()
  })

  it('an admin created without 2FA (as the bootstrap script now creates one) logs in with email + password alone, no 2FA challenge', async () => {
    const email = uniqueEmail('bootstrap-login-no2fa')
    const password = 'a-strong-bootstrap-password'
    // Mirrors exactly what runBootstrap now produces: SUPER_ADMIN,
    // ACTIVE, VERIFIED, twoFactorEnabled=false, no TwoFactorCredential row.
    await createUserDirect(prisma, { email, password, role: 'SUPER_ADMIN' })

    const login = await request(server).post('/auth/login').send({ email, password }).expect(200)
    expect(login.body.needsTwoFactor).toBeUndefined()
    expect(login.body.user.role).toBe('SUPER_ADMIN')
    const cookie = extractSessionCookie(login)
    await request(server).get('/auth/me').set('Cookie', cookie).expect(200)
  })

  it('existing 2FA-enabled accounts still require a valid TOTP code at login — unchanged by this change', async () => {
    const email = uniqueEmail('bootstrap-existing-2fa')
    const password = 'a-strong-bootstrap-password'
    const { user } = await createUserDirect(prisma, { email, password, role: 'ADMIN' })
    const secret = await enableTotpDirect(prisma, user.id)

    const loginRes = await request(server).post('/auth/login').send({ email, password }).expect(200)
    expect(loginRes.body.needsTwoFactor).toBe(true)
    expect(loginRes.headers['set-cookie']).toBeUndefined()

    await request(server)
      .post('/auth/2fa/login-verify')
      .send({ pendingToken: loginRes.body.pendingToken, code: '000000' })
      .expect(401)

    const verified = await request(server)
      .post('/auth/2fa/login-verify')
      .send({ pendingToken: loginRes.body.pendingToken, code: currentTotpCode(secret) })
      .expect(200)
    expect(verified.headers['set-cookie']).toBeDefined()
  })
})
