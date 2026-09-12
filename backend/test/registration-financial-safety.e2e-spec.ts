import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect, enableTotpDirect, currentTotpCode } from './helpers/test-app'
import { LedgerService } from '../src/ledger/ledger.service'
import type { PrismaService } from '../src/prisma/prisma.service'

// Proves the fix for the automatic $25,000 registration grant that the
// Customer Asset Data Integrity Audit flagged: registration must create
// identity + an account structure and NOTHING financial. These tests read
// directly from PostgreSQL (real ledger tables), not from any cached/API
// value, so they can't be fooled by a display-layer default of "0".
describe('Registration financial safety (real PostgreSQL)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let ledger: LedgerService
  let server: any

  beforeAll(async () => {
    const t = await createTestApp()
    app = t.app
    prisma = t.prisma
    server = app.getHttpServer()
    ledger = app.get(LedgerService)
  })

  afterAll(async () => {
    await app.close()
  })

  async function registerViaHttp(prefix: string) {
    const email = uniqueEmail(prefix)
    const password = 'correct-horse-battery'
    const res = await request(server)
      .post('/auth/register')
      .send({ email, password, fullName: 'Zero Balance User' })
      .expect(201)
    return { email, password, userId: res.body.user.id, cookie: extractSessionCookie(res) }
  }

  it('a brand-new registration creates no ledger accounts and no ledger transaction at all', async () => {
    const { userId } = await registerViaHttp('zero1')

    const account = await prisma.account.findFirstOrThrow({ where: { userId } })

    // No LedgerAccount row exists yet — registration didn't even reach for
    // one. (LedgerAccount rows are created lazily by the first real
    // financial event, not by registration.)
    const ledgerAccounts = await prisma.ledgerAccount.findMany({ where: { accountId: account.id } })
    expect(ledgerAccounts).toHaveLength(0)

    // No LedgerTransaction referencing this account exists.
    const transactions = await prisma.ledgerTransaction.findMany({ where: { relatedType: 'ACCOUNT', relatedId: account.id } })
    expect(transactions).toHaveLength(0)

    // And the derived balances (which lazily create zero-entry ledger
    // accounts as a side effect of even asking) are all exactly zero.
    const balances = await ledger.getAccountBalances(account.id)
    expect(balances.cash.toString()).toBe('0')
    expect(balances.reserved.toString()).toBe('0')
    expect(balances.total.toString()).toBe('0')

    // Same thing, through the real HTTP summary endpoint a client would use.
    const cookie = extractSessionCookie(await request(server).post('/auth/login').send({ email: (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).email, password: 'correct-horse-battery' }))
    const summary = await request(server).get('/accounts/me/summary').set('Cookie', cookie).expect(200)
    expect(summary.body.cash).toBe('0')
    expect(summary.body.reserved).toBe('0')
    expect(summary.body.total).toBe('0')
    expect(summary.body.equity).toBe('0')
  })

  it('two independently registered users both start at exactly $0, with no automatic transaction for either', async () => {
    const a = await registerViaHttp('zeroA')
    const b = await registerViaHttp('zeroB')

    for (const { userId } of [a, b]) {
      const account = await prisma.account.findFirstOrThrow({ where: { userId } })
      const ledgerAccounts = await prisma.ledgerAccount.findMany({ where: { accountId: account.id } })
      expect(ledgerAccounts).toHaveLength(0)

      const balances = await ledger.getAccountBalances(account.id)
      expect(balances.total.toString()).toBe('0')
    }
  })

  it('registration itself stays financially inert; only an explicit admin financial adjustment changes the balance', async () => {
    const { userId, cookie } = await registerViaHttp('explicitadjust')

    // Confirm still $0 right after registration.
    let account = await prisma.account.findFirstOrThrow({ where: { userId } })
    let balances = await ledger.getAccountBalances(account.id)
    expect(balances.cash.toString()).toBe('0')

    // Now perform one explicit, authorized, step-up-protected admin
    // financial adjustment — the ONLY thing that should move this balance.
    const superEmail = uniqueEmail('explicitsuper')
    const superPassword = 'correct-horse-battery'
    const { user: superUser } = await createUserDirect(prisma, { email: superEmail, password: superPassword, role: 'SUPER_ADMIN' })
    const superSecret = await enableTotpDirect(prisma, superUser.id)
    const loginRes = await request(server).post('/auth/login').send({ email: superEmail, password: superPassword }).expect(200)
    const verifyRes = await request(server)
      .post('/auth/2fa/login-verify')
      .send({ pendingToken: loginRes.body.pendingToken, code: currentTotpCode(superSecret) })
      .expect(200)
    const superCookie = extractSessionCookie(verifyRes)

    await request(server)
      .post('/admin/financial-adjustment')
      .set('Cookie', superCookie)
      .send({ userId, amount: '42', direction: 'CREDIT', reason: 'explicit test adjustment, not registration', confirmPassword: superPassword })
      .expect(201)

    account = await prisma.account.findFirstOrThrow({ where: { userId } })
    balances = await ledger.getAccountBalances(account.id)
    expect(balances.cash.toString()).toBe('42') // exactly the explicit adjustment, nothing more

    void cookie // (unused beyond documenting the user's own session exists)
  })

  it('registration creates zero balance regardless of NODE_ENV — this is not an environment-gated behavior', async () => {
    const originalEnv = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'production'
      const { userId } = await registerViaHttp('prodlike')
      const account = await prisma.account.findFirstOrThrow({ where: { userId } })
      const balances = await ledger.getAccountBalances(account.id)
      expect(balances.total.toString()).toBe('0')
      const ledgerAccounts = await prisma.ledgerAccount.findMany({ where: { accountId: account.id } })
      // Only exist because getAccountBalances() above lazily created them —
      // zero entries either way.
      for (const la of ledgerAccounts) {
        const entryCount = await prisma.ledgerEntry.count({ where: { ledgerAccountId: la.id } })
        expect(entryCount).toBe(0)
      }
    } finally {
      process.env.NODE_ENV = originalEnv
    }
  })
})
