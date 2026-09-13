import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Decimal } from '@prisma/client/runtime/library'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect } from './helpers/test-app'
import { LedgerService } from '../src/ledger/ledger.service'
import { OptionsService } from '../src/options/options.service'
import type { PrismaService } from '../src/prisma/prisma.service'

// The seven-tier amount-based duration system — the operator's final
// trading spec, replacing the earlier flat 30/60/90/120/180s @ 5/7/9/12/15%
// ladder (which had minAmount=0 on every tier, i.e. no real tiering at
// all). Every boundary example from the spec is tested explicitly, plus
// the below-minimum/above-maximum rejections and the DURATION_TIER_MISMATCH
// check (a real gap found and fixed alongside this: the prior code only
// verified an investment met the SUBMITTED duration's own floor, never that
// it was the CORRECT tier — a client could submit a huge investment against
// the smallest tier's duration and it would have incorrectly passed).
describe('Seven-tier amount-based options trading (real PostgreSQL)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let ledger: LedgerService
  let options: OptionsService
  let server: any
  let superCookie: string
  let superPassword: string
  let symbol: string

  // Exact values from prisma/seed.ts's OPTION_TIERS — the real production
  // configuration, not a simplified test-only substitute.
  const TIERS = [
    { durationSeconds: 30, payoutPercent: '10', minAmount: '500' },
    { durationSeconds: 60, payoutPercent: '12', minAmount: '1000.01' },
    { durationSeconds: 120, payoutPercent: '15', minAmount: '5000.01' },
    { durationSeconds: 300, payoutPercent: '18', minAmount: '10000.01' },
    { durationSeconds: 600, payoutPercent: '22', minAmount: '50000.01' },
    { durationSeconds: 900, payoutPercent: '25', minAmount: '100000.01' },
    { durationSeconds: 1800, payoutPercent: '30', minAmount: '250000.01' },
  ]

  beforeAll(async () => {
    const t = await createTestApp()
    app = t.app
    prisma = t.prisma
    server = app.getHttpServer()
    ledger = app.get(LedgerService)
    options = app.get(OptionsService)

    const email = uniqueEmail('seventiersuper')
    superPassword = 'correct-horse-battery'
    await createUserDirect(prisma, { email, password: superPassword, role: 'SUPER_ADMIN' })
    const loginRes = await request(server).post('/auth/login').send({ email, password: superPassword }).expect(200)
    superCookie = extractSessionCookie(loginRes)

    await request(server)
      .patch('/admin/options/settings')
      .set('Cookie', superCookie)
      .send({ tradingEnabled: true, reason: 'enable for seven-tier e2e suite', confirmPassword: superPassword })
      .expect(200)

    symbol = `SEVENTIER-TEST/USDT-${Date.now()}`
    await prisma.marketConfig.create({
      data: { symbol, dataSource: 'SIMULATED', tradingEnabled: true, enabled: true, baseAsset: 'TEST', quoteAsset: 'USDT', marketType: 'CRYPTO_SPOT', provider: 'SIMULATED', providerSymbol: 'BTCUSDT' },
    })
    const market = await prisma.optionMarket.create({
      // maxInvestment: null — no platform-wide cap, matching the real
      // prisma/seed.ts config. The top tier ($250,000.01+) is unbounded.
      data: { symbol, enabled: true, currency: 'USDT', minInvestment: new Decimal('500'), maxInvestment: null },
    })
    for (const tier of TIERS) {
      await prisma.optionDuration.create({
        data: { optionMarketId: market.id, durationSeconds: tier.durationSeconds, payoutPercent: new Decimal(tier.payoutPercent), minAmount: new Decimal(tier.minAmount), enabled: true },
      })
    }
  })

  afterAll(async () => {
    await request(server)
      .patch('/admin/options/settings')
      .set('Cookie', superCookie)
      .send({ tradingEnabled: false, reason: 'restore after seven-tier e2e suite', confirmPassword: superPassword })
    await app.close()
  })

  async function registerAndLogin(prefix: string) {
    const email = uniqueEmail(prefix)
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, fullName: 'Seven Tier Test', role: 'USER' })
    const res = await request(server).post('/auth/login').send({ email, password }).expect(200)
    return { userId: user.id, cookie: extractSessionCookie(res) }
  }

  async function grantAsset(userId: string, amount: string) {
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const { cash } = await ledger.getOrCreateUserLedgerAccounts(account.id, 'USDT')
    const revenue = await ledger.getSystemLedgerAccount('REVENUE', 'USDT')
    await ledger.postTransaction({
      description: 'seven-tier test fixture asset grant',
      idempotencyKey: `seventier-fixture-grant-${userId}-${Date.now()}-${Math.random()}`,
      entries: [
        { ledgerAccountId: revenue.id, direction: 'DEBIT', amount, currency: 'USDT', entryType: 'ADJUSTMENT' },
        { ledgerAccountId: cash.id, direction: 'CREDIT', amount, currency: 'USDT', entryType: 'ADJUSTMENT' },
      ],
    })
  }

  // ---- Every boundary example from the spec, exactly ----

  it.each([
    [500, 30, '10'], [750, 30, '10'], [1000, 30, '10'],
    [1001, 60, '12'], [5000, 60, '12'],
    [5001, 120, '15'], [10000, 120, '15'],
    [10001, 300, '18'], [50000, 300, '18'],
    [50001, 600, '22'], [100000, 600, '22'],
    [100001, 900, '25'], [250000, 900, '25'],
    [250001, 1800, '30'], [500000, 1800, '30'],
  ])('$%i resolves to the %is / %s%% tier and is accepted by the backend', async (amount, expectedDuration, expectedPayout) => {
    const { userId, cookie } = await registerAndLogin(`b${amount}`)
    await grantAsset(userId, '600000')

    const res = await request(server)
      .post('/options/trades')
      .set('Cookie', cookie)
      .send({ symbol, direction: 'BUY', investment: String(amount), durationSeconds: expectedDuration })
      .expect(201)

    expect(res.body.durationSeconds).toBe(expectedDuration)
    expect(res.body.payoutPercentSnapshot).toBe(expectedPayout)
  })

  it('$499 (below the lowest tier and the market minimum) is rejected — never fabricates a tier', async () => {
    const { userId, cookie } = await registerAndLogin('below499')
    await grantAsset(userId, '1000')
    const res = await request(server).post('/options/trades').set('Cookie', cookie).send({ symbol, direction: 'BUY', investment: '499', durationSeconds: 30 }).expect(400)
    expect(res.body.message).toMatch(/MIN_INVESTMENT_NOT_MET/)
  })

  it('has no upper cap — $750,000 (above the old $500,000 ceiling) is accepted and still resolves to the top tier', async () => {
    const { userId, cookie } = await registerAndLogin('above500001')
    await grantAsset(userId, '1000000')
    const res = await request(server).post('/options/trades').set('Cookie', cookie).send({ symbol, direction: 'BUY', investment: '750000', durationSeconds: 1800 }).expect(201)
    expect(res.body.durationSeconds).toBe(1800)
    expect(res.body.payoutPercentSnapshot).toBe('30')
  })

  // ---- The real gap this task fixed: duration must match the amount's
  // ACTUAL tier, not just be "big enough" for its own floor ----

  it('SECURITY: submitting a large investment against the SMALLEST tier duration is rejected, even though the amount comfortably exceeds that duration\'s own minAmount', async () => {
    const { userId, cookie } = await registerAndLogin('tiercheat')
    await grantAsset(userId, '100000')
    // $50,000 genuinely qualifies for the 300s/18% tier (10000.01+), not
    // the 30s/10% tier — before this fix, only the 30s tier's OWN floor
    // ($500) was checked, so this would have incorrectly been accepted.
    const res = await request(server).post('/options/trades').set('Cookie', cookie).send({ symbol, direction: 'BUY', investment: '50000', durationSeconds: 30 }).expect(400)
    expect(res.body.message).toMatch(/DURATION_TIER_MISMATCH/)
    expect(res.body.message).toMatch(/300s/)
  })

  it('SECURITY: the correct duration for that same $50,000 amount is accepted', async () => {
    const { userId, cookie } = await registerAndLogin('tiercorrect')
    await grantAsset(userId, '100000')
    await request(server).post('/options/trades').set('Cookie', cookie).send({ symbol, direction: 'BUY', investment: '50000', durationSeconds: 300 }).expect(201)
  })

  // ---- Changing the amount must never leave stale duration/ROI state
  // (Step 3 requirement) — verified at the resolution level: a fresh
  // request for a smaller amount is judged purely on its own merits. ----

  it('changing the amount from $10,000 to $75,000 resolves a genuinely different tier, not a stale one', async () => {
    const { userId, cookie } = await registerAndLogin('changeamt1')
    await grantAsset(userId, '100000')
    const first = await request(server).post('/options/trades').set('Cookie', cookie).send({ symbol, direction: 'BUY', investment: '10000', durationSeconds: 120 }).expect(201)
    expect(first.body.durationSeconds).toBe(120)

    // The SAME duration (120s) is no longer correct for $75,000 — it must
    // now resolve to 600s/22%. Submitting the OLD duration against the NEW
    // amount is exactly the stale-state bug this must never allow.
    const stale = await request(server).post('/options/trades').set('Cookie', cookie).send({ symbol, direction: 'BUY', investment: '75000', durationSeconds: 120 }).expect(400)
    expect(stale.body.message).toMatch(/DURATION_TIER_MISMATCH/)

    const correct = await request(server).post('/options/trades').set('Cookie', cookie).send({ symbol, direction: 'BUY', investment: '75000', durationSeconds: 600 }).expect(201)
    expect(correct.body.durationSeconds).toBe(600)
  })

  it('changing the amount from $75,000 down to $500 resolves back to the smallest tier, not whatever was previously active', async () => {
    const { userId, cookie } = await registerAndLogin('changeamt2')
    await grantAsset(userId, '100000')
    const big = await request(server).post('/options/trades').set('Cookie', cookie).send({ symbol, direction: 'BUY', investment: '75000', durationSeconds: 600 }).expect(201)
    await options.settleTrade(big.body.id) // free the reservation so the next trade isn't blocked by an active one

    const small = await request(server).post('/options/trades').set('Cookie', cookie).send({ symbol, direction: 'BUY', investment: '500', durationSeconds: 30 }).expect(201)
    expect(small.body.durationSeconds).toBe(30)
    expect(small.body.payoutPercentSnapshot).toBe('10')
  })

  // ---- Profit/return math, end to end, using the new ROI values ----

  it('settlement profit/return math matches Investment x ROI / 100 exactly, for the new ROI values', async () => {
    const { userId, cookie } = await registerAndLogin('roimath')
    await grantAsset(userId, '20000')
    const trade = await request(server)
      .post('/options/trades')
      .set('Cookie', cookie)
      .send({ symbol, direction: 'BUY', investment: '10000', durationSeconds: 120, requestedResultMode: 'FORCE_WIN' })
      .expect(201)

    const settled = await options.settleTrade(trade.body.id)
    expect(settled.status).toBe('SETTLED')
    expect(settled.result).toBe('WIN')
    // 10,000 * 15% = 1,500 profit; ledger releases investment + profit.
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const balances = await ledger.getAccountBalances(account.id, 'USDT')
    expect(balances.cash.toString()).toBe('21500') // 20000 - 10000 (reserved) + 10000 (returned) + 1500 (profit)
  })
})
