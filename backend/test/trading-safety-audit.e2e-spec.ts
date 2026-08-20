import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect } from './helpers/test-app'
import { LedgerService } from '../src/ledger/ledger.service'
import type { PrismaService } from '../src/prisma/prisma.service'

// Phase 6D — closes two real, verified gaps found during the trading/
// execution architecture audit: `maintenanceMode` (a separate code path
// from `tradingEnabled` in OrdersService.createOrder(), see the
// `if (marketConfig.maintenanceMode)` branch) had NO test anywhere in the
// suite, and order creation's Idempotency-Key-conflict behavior had only
// ever been tested for withdrawals (idempotency-hardening.e2e-spec.ts #5),
// never orders specifically, even though it's the same shared
// IdempotencyService path. No production code was changed to add these —
// both behaviors already existed; this is coverage only.
describe('Trading safety audit — coverage gaps (real PostgreSQL)', () => {
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
    const { user } = await createUserDirect(prisma, { email, password, fullName: 'Trading Safety Audit' })
    const res = await request(server).post('/auth/login').send({ email, password }).expect(200)
    const cookie = extractSessionCookie(res)
    return { userId: user.id, cookie }
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

  // Part 29, item 3 — genuinely untested before this phase.
  it('3. a market under maintenanceMode rejects order attempts, distinctly from tradingEnabled=false, and reserves nothing', async () => {
    const symbol = `MAINT/${Date.now()}`
    await prisma.marketConfig.upsert({
      where: { symbol },
      create: { symbol, dataSource: 'SIMULATED', tradingEnabled: true, maintenanceMode: true },
      update: { tradingEnabled: true, maintenanceMode: true },
    })
    const { userId, cookie } = await registerAndLogin('maintmode')
    await grantBalance(userId, '500')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100' }).expect(201)
    expect(res.body.status).toBe('REJECTED')
    expect(res.body.rejectionReason).toMatch(/maintenance/i)

    // Confirms this is a DIFFERENT rejection reason from tradingEnabled=false
    // (already covered in platform-controls.e2e-spec.ts, message matches
    // /not enabled/i) — the two are genuinely separate conditions/messages,
    // not the same check reused twice.
    expect(res.body.rejectionReason).not.toMatch(/not enabled/i)

    // Nothing was reserved — full balance still available.
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const balances = await ledger.getAccountBalances(account.id)
    expect(balances.cash.toString()).toBe('500')
    expect(balances.reserved.toString()).toBe('0')
  })

  // Part 29, item 8 — order-specific (idempotency-hardening.e2e-spec.ts's
  // equivalent test, #5, only ever exercised /withdrawals).
  it('8. reusing the same Idempotency-Key for /orders with a materially different request is rejected, not silently applied', async () => {
    const symbol = `IDEM/${Date.now()}`
    await prisma.marketConfig.upsert({
      where: { symbol },
      create: { symbol, dataSource: 'SIMULATED', tradingEnabled: true },
      update: { tradingEnabled: true },
    })
    const { userId, cookie } = await registerAndLogin('orderidemconflict')
    await grantBalance(userId, '1000')
    const key = `okey-conflict-${Date.now()}`

    const first = await request(server).post('/orders').set('Cookie', cookie).set('Idempotency-Key', key).send({ symbol, side: 'BUY', quantity: '100' }).expect(201)

    // Same key, different quantity — must be rejected as a conflict, not
    // silently replayed and not silently applied as a second order.
    await request(server).post('/orders').set('Cookie', cookie).set('Idempotency-Key', key).send({ symbol, side: 'BUY', quantity: '999' }).expect(409)

    const count = await prisma.order.count({ where: { userId, symbol } })
    expect(count).toBe(1)
    expect(count && first.body.id).toBeDefined()

    // Exactly one logical order's worth of ledger activity occurred — the
    // reserve+release pair for the ONE legitimate order (both SIMULATED
    // orders reject immediately after reserving, per OrdersService's
    // documented no-broker-connected behavior), never a second one.
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const balances = await ledger.getAccountBalances(account.id)
    expect(balances.cash.toString()).toBe('1000') // reserved then released, exactly once
  })
})
