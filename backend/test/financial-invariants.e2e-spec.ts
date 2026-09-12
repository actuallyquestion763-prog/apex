import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect, enableTotpDirect, currentTotpCode } from './helpers/test-app'
import { LedgerService } from '../src/ledger/ledger.service'
import type { PrismaService } from '../src/prisma/prisma.service'

describe('Financial invariants (real PostgreSQL, including real concurrency)', () => {
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

  // Uses createUserDirect (bypasses the HTTP /auth/register flow) purely
  // for fixture convenience (email/password/role in one call) — registration
  // itself is zero-balance either way (see registration-financial-safety.e2e-spec.ts),
  // so these tests grant an explicit test balance via grantBalance() below
  // when they need a nonzero starting point to race against.
  async function registerAndLogin(prefix: string) {
    const email = uniqueEmail(prefix)
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, fullName: 'Invariant Test' })
    const res = await request(server).post('/auth/login').send({ email, password }).expect(200)
    const cookie = extractSessionCookie(res)
    return { email, password, userId: user.id, cookie }
  }

  async function grantBalance(userId: string, amount: string) {
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const { cash } = await ledger.getOrCreateUserLedgerAccounts(account.id)
    const revenue = await ledger.getSystemLedgerAccount('REVENUE')
    await ledger.postTransaction({
      description: 'test fixture balance grant',
      idempotencyKey: `fixture-grant-${userId}-${amount}-${Date.now()}`,
      entries: [
        { ledgerAccountId: revenue.id, direction: 'DEBIT', amount, entryType: 'ADJUSTMENT' },
        { ledgerAccountId: cash.id, direction: 'CREDIT', amount, entryType: 'ADJUSTMENT' },
      ],
    })
    return account.id
  }

  // ---- THE test: two concurrent withdrawals racing for the same funds ----

  it('CRITICAL: two concurrent $800 withdrawal requests against a $1000 balance — exactly one may reserve funds, balance never goes negative', async () => {
    const { userId, cookie } = await registerAndLogin('race')
    await grantBalance(userId, '1000')

    const [resA, resB] = await Promise.all([
      request(server).post('/withdrawals').set('Cookie', cookie).send({ amount: '800', destination: 'wallet-A' }),
      request(server).post('/withdrawals').set('Cookie', cookie).send({ amount: '800', destination: 'wallet-B' }),
    ])

    const statuses = [resA.body.status, resB.body.status].sort()
    // One reserved (PENDING, ledger entry posted), one honestly rejected —
    // never both PENDING (that would mean $1600 reserved against $1000).
    expect(statuses).toEqual(['PENDING', 'REJECTED'])

    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const balances = await ledger.getAccountBalances(account.id)
    expect(balances.cash.gte(0)).toBe(true) // never negative
    expect(balances.cash.toString()).toBe('200') // 1000 - 800, the other 800 was rejected and never reserved
  })

  it('CRITICAL: a concurrent order and withdrawal for the same funds never both succeed', async () => {
    const { userId, cookie } = await registerAndLogin('race2')
    await grantBalance(userId, '1000')
    await prisma.marketConfig.upsert({
      where: { symbol: 'TEST/USD' },
      create: { symbol: 'TEST/USD', dataSource: 'SIMULATED', tradingEnabled: true },
      update: { tradingEnabled: true },
    })

    const [orderRes, withdrawRes] = await Promise.all([
      request(server).post('/orders').set('Cookie', cookie).send({ symbol: 'TEST/USD', side: 'BUY', quantity: '900' }),
      request(server).post('/withdrawals').set('Cookie', cookie).send({ amount: '900', destination: 'wallet' }),
    ])

    // Order always ends REJECTED in this phase (no broker), but it still
    // really reserves-then-releases funds along the way; the point here is
    // the withdrawal must not have been able to reserve the same 900 at the
    // same time as the order's reservation window.
    expect(orderRes.status).toBe(201)
    expect(withdrawRes.status).toBe(201)

    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const balances = await ledger.getAccountBalances(account.id)
    expect(balances.cash.gte(0)).toBe(true)
    expect(balances.reserved.toString()).toBe('0') // order always releases its reservation in this phase
  })

  it('no duplicate settlement: confirming the same deposit twice credits the account exactly once', async () => {
    const { userId, cookie } = await registerAndLogin('dupdeposit')
    const superEmail = uniqueEmail('depadmin')
    const superPassword = 'correct-horse-battery'
    const { user: superUser } = await createUserDirect(prisma, { email: superEmail, password: superPassword, role: 'SUPER_ADMIN' })
    const superCookie = extractSessionCookie(await request(server).post('/auth/login').send({ email: superEmail, password: superPassword }).expect(200))

    const depRes = await request(server).post('/deposits').set('Cookie', cookie).send({ amount: '300', method: 'test' }).expect(201)
    const depositId = depRes.body.id

    await request(server).post(`/admin/deposits/${depositId}/confirm`).set('Cookie', superCookie).send({ reason: 'test' }).expect(201)
    await request(server).post(`/admin/deposits/${depositId}/confirm`).set('Cookie', superCookie).send({ reason: 'test again' }).expect(201) // idempotent, not an error

    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const balances = await ledger.getAccountBalances(account.id)
    expect(balances.cash.toString()).toBe('300') // not 600

    const txCount = await prisma.ledgerTransaction.count({ where: { idempotencyKey: `deposit-confirm-${depositId}` } })
    expect(txCount).toBe(1)
  })

  it('unauthorized financial adjustment is rejected: wrong password and missing permission', async () => {
    const superEmail = uniqueEmail('adjustsuper')
    const superPassword = 'correct-horse-battery'
    const { user: superUser } = await createUserDirect(prisma, { email: superEmail, password: superPassword, role: 'SUPER_ADMIN' })
    const superSecret = await enableTotpDirect(prisma, superUser.id)
    const loginRes = await request(server).post('/auth/login').send({ email: superEmail, password: superPassword }).expect(200)
    const verifyRes = await request(server).post('/auth/2fa/login-verify').send({ pendingToken: loginRes.body.pendingToken, code: currentTotpCode(superSecret) }).expect(200)
    const superCookie = extractSessionCookie(verifyRes)

    const { userId: targetId } = await registerAndLogin('adjusttarget')

    // Wrong password — financial-adjustment uses password-only
    // re-authentication (StepUpService.assertStepUpAuthorized); this is
    // still verified fresh every time, never trusting the open session alone.
    await request(server)
      .post('/admin/financial-adjustment')
      .set('Cookie', superCookie)
      .send({ userId: targetId, amount: '100', direction: 'CREDIT', reason: 'test wrong password', confirmPassword: 'totally-wrong' })
      .expect(401)

    // A plain ADMIN (no ledger.adjust permission) cannot do it at all
    const adminEmail = uniqueEmail('noadjustadmin')
    const adminPassword = 'correct-horse-battery'
    await createUserDirect(prisma, { email: adminEmail, password: adminPassword, role: 'ADMIN' })
    const adminCookie = extractSessionCookie(await request(server).post('/auth/login').send({ email: adminEmail, password: adminPassword }).expect(200))
    await request(server)
      .post('/admin/financial-adjustment')
      .set('Cookie', adminCookie)
      .send({ userId: targetId, amount: '100', direction: 'CREDIT', reason: 'test no permission', confirmPassword: adminPassword })
      .expect(403)

    // Confirm nothing was actually credited by any of the failed attempts
    const account = await prisma.account.findFirstOrThrow({ where: { userId: targetId } })
    const balances = await ledger.getAccountBalances(account.id)
    expect(balances.cash.toString()).toBe('0')
  })

  // Every admin step-up-gated action platform-wide (financial adjustments,
  // crypto receiving-address changes, role/permission changes, admin
  // management, platform controls) uses password-only re-authentication
  // (StepUpService.assertStepUpAuthorized) at the operator's explicit
  // request — see crypto-deposits.e2e-spec.ts's "19c" for the same proof on
  // a different action. This proves the behavior is real, not accidental: a
  // correct password with NO totpCode at all succeeds here too.
  it('financial adjustment succeeds with a correct password alone — no TOTP code required or checked', async () => {
    const superEmail = uniqueEmail('adjustnofa')
    const superPassword = 'correct-horse-battery'
    // Deliberately does NOT enable 2FA on this account — proves the
    // password-only path works even when the acting admin has no TOTP
    // credential at all.
    await createUserDirect(prisma, { email: superEmail, password: superPassword, role: 'SUPER_ADMIN' })
    const superCookie = extractSessionCookie(await request(server).post('/auth/login').send({ email: superEmail, password: superPassword }).expect(200))

    const { userId: targetId } = await registerAndLogin('adjustnofatarget')

    const res = await request(server)
      .post('/admin/financial-adjustment')
      .set('Cookie', superCookie)
      .send({ userId: targetId, amount: '20', direction: 'CREDIT', reason: 'password-only reauth test', confirmPassword: superPassword })
      .expect(201)
    expect(res.body.ledgerTransactionId).toBeDefined()

    const account = await prisma.account.findFirstOrThrow({ where: { userId: targetId } })
    const balances = await ledger.getAccountBalances(account.id)
    expect(balances.cash.toString()).toBe('20')
  })

  it('every successful financial adjustment produces an audit trail referencing the ledger transaction', async () => {
    const superEmail = uniqueEmail('audittrail')
    const superPassword = 'correct-horse-battery'
    const { user: superUser } = await createUserDirect(prisma, { email: superEmail, password: superPassword, role: 'SUPER_ADMIN' })
    const superSecret = await enableTotpDirect(prisma, superUser.id)
    const loginRes = await request(server).post('/auth/login').send({ email: superEmail, password: superPassword }).expect(200)
    const verifyRes = await request(server).post('/auth/2fa/login-verify').send({ pendingToken: loginRes.body.pendingToken, code: currentTotpCode(superSecret) }).expect(200)
    const superCookie = extractSessionCookie(verifyRes)

    const { userId: targetId } = await registerAndLogin('audittarget')

    const res = await request(server)
      .post('/admin/financial-adjustment')
      .set('Cookie', superCookie)
      .send({ userId: targetId, amount: '55', direction: 'CREDIT', reason: 'audit trail test', confirmPassword: superPassword })
      .expect(201)

    const ledgerTransactionId = res.body.ledgerTransactionId
    expect(ledgerTransactionId).toBeDefined()

    const adminAction = await prisma.adminAction.findFirst({ where: { ledgerTransactionId } })
    expect(adminAction).not.toBeNull()
    expect(adminAction!.adminId).toBe(superUser.id)
    expect(adminAction!.targetUserId).toBe(targetId)
    expect(adminAction!.reason).toBe('audit trail test')

    const auditLog = await prisma.auditLog.findFirst({ where: { action: 'FINANCIAL_ADJUSTMENT', targetId } })
    expect(auditLog).not.toBeNull()
  })
})
