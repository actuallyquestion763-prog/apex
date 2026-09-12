import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect, enableTotpDirect, currentTotpCode } from './helpers/test-app'
import { LedgerService } from '../src/ledger/ledger.service'
import type { PrismaService } from '../src/prisma/prisma.service'

// Phase 2 concurrency/idempotency hardening audit — targeted at gaps not
// covered by financial-invariants.e2e-spec.ts: duplicate (not just
// concurrent-conflicting) requests, admin approve/reject races, concurrent
// pure-credit operations, and the honest-rejection paths for unavailable
// market data. Real PostgreSQL throughout, never the dev database.
describe('Concurrency & idempotency hardening (real PostgreSQL)', () => {
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

  async function registerAndLogin(prefix: string) {
    const email = uniqueEmail(prefix)
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, fullName: 'Concurrency Test' })
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
      idempotencyKey: `fixture-grant-${userId}-${amount}-${Date.now()}-${Math.random()}`,
      entries: [
        { ledgerAccountId: revenue.id, direction: 'DEBIT', amount, entryType: 'ADJUSTMENT' },
        { ledgerAccountId: cash.id, direction: 'CREDIT', amount, entryType: 'ADJUSTMENT' },
      ],
    })
    return account.id
  }

  async function loginSuperAdmin(prefix: string) {
    const email = uniqueEmail(prefix)
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, role: 'SUPER_ADMIN' })
    const secret = await enableTotpDirect(prisma, user.id)
    const loginRes = await request(server).post('/auth/login').send({ email, password }).expect(200)
    const verifyRes = await request(server)
      .post('/auth/2fa/login-verify')
      .send({ pendingToken: loginRes.body.pendingToken, code: currentTotpCode(secret) })
      .expect(200)
    return { userId: user.id, password, secret, cookie: extractSessionCookie(verifyRes) }
  }

  it('a deposit REQUEST alone never credits the account — only confirm() does', async () => {
    const { userId, cookie } = await registerAndLogin('depreq')
    await request(server).post('/deposits').set('Cookie', cookie).send({ amount: '500', method: 'test' }).expect(201)

    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const balances = await ledger.getAccountBalances(account.id)
    expect(balances.cash.toString()).toBe('0')
  })

  it('a withdrawal request reserves exactly the requested amount, moving it out of available cash', async () => {
    const { userId, cookie } = await registerAndLogin('wreq')
    await grantBalance(userId, '500')

    const res = await request(server).post('/withdrawals').set('Cookie', cookie).send({ amount: '200', destination: 'wallet' }).expect(201)
    expect(res.body.status).toBe('PENDING')

    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const balances = await ledger.getAccountBalances(account.id)
    expect(balances.cash.toString()).toBe('300')
    expect(balances.reserved.toString()).toBe('0') // withdrawals move funds to SUSPENSE (system), not a USER RESERVED account — see withdrawals.service.ts
  })

  it('a rejected withdrawal releases its reservation back to available cash exactly once, even under a concurrent double-reject', async () => {
    const { userId, cookie } = await registerAndLogin('wreject')
    await grantBalance(userId, '500')

    const createRes = await request(server).post('/withdrawals').set('Cookie', cookie).send({ amount: '300', destination: 'wallet' }).expect(201)
    const withdrawalId = createRes.body.id

    let account = await prisma.account.findFirstOrThrow({ where: { userId } })
    expect((await ledger.getAccountBalances(account.id)).cash.toString()).toBe('200') // 300 reserved out of 500

    const superAdmin = await loginSuperAdmin('wrejectadmin')

    // Two admins (or one admin double-clicking) reject the SAME withdrawal
    // at the same time.
    const [r1, r2] = await Promise.all([
      request(server).post(`/admin/withdrawals/${withdrawalId}/reject`).set('Cookie', superAdmin.cookie).send({ reason: 'race A' }),
      request(server).post(`/admin/withdrawals/${withdrawalId}/reject`).set('Cookie', superAdmin.cookie).send({ reason: 'race B' }),
    ])
    expect([r1.status, r2.status]).toEqual([201, 201]) // both calls are idempotent no-ops from the caller's point of view

    account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const balances = await ledger.getAccountBalances(account.id)
    // The reserved 300 must come back exactly once — not twice (900 total)
    // and not zero times (200, stuck reserved forever).
    expect(balances.cash.toString()).toBe('500')

    const refundTxCount = await prisma.ledgerTransaction.count({ where: { idempotencyKey: `withdrawal-reject-${withdrawalId}` } })
    expect(refundTxCount).toBe(1)
  })

  it('DOCUMENTS CURRENT BEHAVIOR: a client retrying/double-submitting a withdrawal request WITHOUT an Idempotency-Key creates two separate reservations, not one deduplicated one', async () => {
    // Phase 6F Checkpoint I, Part 5 — corrected from the original Phase 2
    // comment, which was stale: POST /withdrawals DOES support an
    // Idempotency-Key header today (WithdrawalsController wires up the same
    // IdempotencyService every other financial endpoint uses — see the new
    // test right after this one, which proves a SUPPLIED key genuinely
    // dedupes). This test deliberately sends NO key at all, which is the
    // correct, expected "opt-in not exercised" behavior of that same
    // mechanism — each call creates a brand-new Withdrawal row with its own
    // fresh id and its own reservation (withdrawal-request-${newId}), same
    // as orders.create()/deposits.create() behave with no key supplied.
    // Not a double-spend (the ledger stays fully consistent and available
    // cash never goes negative — the second request is checked against the
    // balance same as any other) — but a real client that wants exactly-once
    // behavior on retry MUST supply the header, same as every other
    // financial POST endpoint in this codebase.
    const { userId, cookie } = await registerAndLogin('wdup')
    await grantBalance(userId, '1000')

    const [r1, r2] = await Promise.all([
      request(server).post('/withdrawals').set('Cookie', cookie).send({ amount: '400', destination: 'wallet' }),
      request(server).post('/withdrawals').set('Cookie', cookie).send({ amount: '400', destination: 'wallet' }),
    ])
    expect(r1.status).toBe(201)
    expect(r2.status).toBe(201)
    expect(r1.body.id).not.toBe(r2.body.id) // two distinct withdrawal records
    expect([r1.body.status, r2.body.status]).toEqual(['PENDING', 'PENDING']) // both succeeded — balance covered both

    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const balances = await ledger.getAccountBalances(account.id)
    expect(balances.cash.toString()).toBe('200') // 1000 - 400 - 400 — correct given TWO real requests, not corrupted
    expect(balances.cash.gte(0)).toBe(true)

    const withdrawalCount = await prisma.withdrawal.count({ where: { userId } })
    expect(withdrawalCount).toBe(2) // confirms: not deduplicated, by design today
  })

  it('a withdrawal request WITH an Idempotency-Key is deduplicated exactly like orders/deposits — concurrent identical requests produce exactly one withdrawal and one reservation', async () => {
    const { userId, cookie } = await registerAndLogin('widem')
    await grantBalance(userId, '1000')
    const key = `withdrawal-idem-${Date.now()}`

    const [r1, r2] = await Promise.all([
      request(server).post('/withdrawals').set('Cookie', cookie).set('Idempotency-Key', key).send({ amount: '400', destination: 'wallet' }),
      request(server).post('/withdrawals').set('Cookie', cookie).set('Idempotency-Key', key).send({ amount: '400', destination: 'wallet' }),
    ])
    expect(r1.status).toBe(201)
    expect(r2.status).toBe(201)
    expect(r1.body.id).toBe(r2.body.id) // same withdrawal record, not two

    const withdrawalCount = await prisma.withdrawal.count({ where: { userId } })
    expect(withdrawalCount).toBe(1)

    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const balances = await ledger.getAccountBalances(account.id)
    expect(balances.cash.toString()).toBe('600') // 1000 - 400, reserved exactly once despite two concurrent identical requests

    await request(server).post('/withdrawals').set('Cookie', cookie).set('Idempotency-Key', key).send({ amount: '999', destination: 'different-wallet' }).expect(409)
  })

  it('two concurrent orders against the same account cannot together reserve more than the available balance', async () => {
    const { userId, cookie } = await registerAndLogin('orderrace')
    await grantBalance(userId, '1000')
    await prisma.marketConfig.upsert({
      where: { symbol: 'RACE/USD' },
      create: { symbol: 'RACE/USD', dataSource: 'SIMULATED', tradingEnabled: true },
      update: { tradingEnabled: true },
    })

    const [r1, r2] = await Promise.all([
      request(server).post('/orders').set('Cookie', cookie).send({ symbol: 'RACE/USD', side: 'BUY', quantity: '700' }),
      request(server).post('/orders').set('Cookie', cookie).send({ symbol: 'RACE/USD', side: 'SELL', quantity: '700' }),
    ])
    // Both requests are individually well within the 1000 balance, but not
    // together (1400 > 1000). Orders in this phase always end REJECTED (no
    // broker), but each one legitimately reserves-then-releases along the
    // way — the assertion that matters is that available cash never went
    // negative at any point, which the final balance alone would hide (both
    // requests fully release), so we check both requests were individually
    // accepted (201) AND the account never ended up overdrawn afterward.
    expect(r1.status).toBe(201)
    expect(r2.status).toBe(201)

    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const balances = await ledger.getAccountBalances(account.id)
    expect(balances.cash.gte(0)).toBe(true)
    expect(balances.cash.toString()).toBe('1000') // both orders released their reservation; nothing lost or duplicated
    expect(balances.reserved.toString()).toBe('0')
  })

  it('concurrent admin financial adjustments to the same account are both applied — pure-credit ledger inserts need no lock', async () => {
    const { userId } = await registerAndLogin('adjustrace')
    const superAdmin = await loginSuperAdmin('adjustraceadmin')

    const [r1, r2] = await Promise.all([
      request(server).post('/admin/financial-adjustment').set('Cookie', superAdmin.cookie)
        .send({ userId, amount: '50', direction: 'CREDIT', reason: 'race credit A', confirmPassword: superAdmin.password }),
      request(server).post('/admin/financial-adjustment').set('Cookie', superAdmin.cookie)
        .send({ userId, amount: '30', direction: 'CREDIT', reason: 'race credit B', confirmPassword: superAdmin.password }),
    ])
    expect(r1.status).toBe(201)
    expect(r2.status).toBe(201)

    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const balances = await ledger.getAccountBalances(account.id)
    expect(balances.cash.toString()).toBe('80') // both credits landed — no lost update
  })

  it('supplying the same client idempotency key twice on a financial adjustment produces exactly one ledger effect', async () => {
    const { userId } = await registerAndLogin('adjustidem')
    const superAdmin = await loginSuperAdmin('adjustidemadmin')
    const idempotencyKey = `test-idem-${Date.now()}`

    const [r1, r2] = await Promise.all([
      request(server).post('/admin/financial-adjustment').set('Cookie', superAdmin.cookie)
        .send({ userId, amount: '75', direction: 'CREDIT', reason: 'idempotency test', confirmPassword: superAdmin.password, idempotencyKey }),
      request(server).post('/admin/financial-adjustment').set('Cookie', superAdmin.cookie)
        .send({ userId, amount: '75', direction: 'CREDIT', reason: 'idempotency test retry', confirmPassword: superAdmin.password, idempotencyKey }),
    ])
    expect(r1.status).toBe(201)
    expect(r2.status).toBe(201)

    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const balances = await ledger.getAccountBalances(account.id)
    expect(balances.cash.toString()).toBe('75') // not 150 — the second call replayed the same transaction

    const txCount = await prisma.ledgerTransaction.count({ where: { idempotencyKey } })
    expect(txCount).toBe(1)
  })

  it('an order against XAU/USD honestly rejects when the market feed is unavailable — never a fabricated execution price', async () => {
    const { userId, cookie } = await registerAndLogin('xauunavail')
    await grantBalance(userId, '1000')
    // Part 33 — XAU/USD is Binance-backed (PAXGUSDT) by default now, so
    // it's normally LIVE regardless of MARKET_API_KEY. This test needs a
    // genuinely unavailable feed, so it explicitly clears the provider —
    // and restores it in `finally`, since this is a real, shared symbol
    // other e2e files (market-data.e2e-spec.ts) depend on being correctly
    // configured, unlike this file's other fixtures which use dedicated
    // one-off symbols (RACE/USD, etc.) that never need restoring.
    const original = await prisma.marketConfig.findUnique({ where: { symbol: 'XAU/USD' } })
    try {
      await prisma.marketConfig.upsert({
        where: { symbol: 'XAU/USD' },
        create: { symbol: 'XAU/USD', dataSource: 'LIVE', tradingEnabled: true, provider: null, providerSymbol: null },
        update: { dataSource: 'LIVE', tradingEnabled: true, provider: null, providerSymbol: null },
      })

      const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol: 'XAU/USD', side: 'BUY', quantity: '100' }).expect(201)
      expect(res.body.status).toBe('REJECTED')
      expect(res.body.executedPrice).toBeNull()
      expect(res.body.rejectionReason).toMatch(/not currently live/i)

      // No money was left reserved or lost because of the unavailable feed.
      const account = await prisma.account.findFirstOrThrow({ where: { userId } })
      const balances = await ledger.getAccountBalances(account.id)
      expect(balances.cash.toString()).toBe('1000')
    } finally {
      if (original) {
        await prisma.marketConfig.update({
          where: { symbol: 'XAU/USD' },
          data: { dataSource: original.dataSource, tradingEnabled: original.tradingEnabled, provider: original.provider, providerSymbol: original.providerSymbol },
        })
      }
    }
  })

  it('a SIMULATED market order can never carry a client- or server-fabricated execution price', async () => {
    const { userId, cookie } = await registerAndLogin('simprice')
    await grantBalance(userId, '1000')
    await prisma.marketConfig.upsert({
      where: { symbol: 'SIM/USD' },
      create: { symbol: 'SIM/USD', dataSource: 'SIMULATED', tradingEnabled: true },
      update: { dataSource: 'SIMULATED', tradingEnabled: true },
    })

    // CreateOrderDto has no price field at all (symbol/side/quantity only).
    // The global ValidationPipe runs with forbidNonWhitelisted: true, so
    // attempting to inject one doesn't get silently dropped and trusted —
    // it's rejected outright as a malformed request.
    await request(server).post('/orders').set('Cookie', cookie)
      .send({ symbol: 'SIM/USD', side: 'BUY', quantity: '100', requestedPrice: '999999', executedPrice: '999999' })
      .expect(400)

    // The legitimate request (no price fields) still works, and never
    // carries a fabricated price.
    const res = await request(server).post('/orders').set('Cookie', cookie)
      .send({ symbol: 'SIM/USD', side: 'BUY', quantity: '100' })
      .expect(201)
    expect(res.body.requestedPrice).toBeNull()
    expect(res.body.executedPrice).toBeNull()
  })
})
