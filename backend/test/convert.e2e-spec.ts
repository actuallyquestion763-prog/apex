import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Decimal } from '@prisma/client/runtime/library'
import type { MarketDataSource } from '@prisma/client'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect } from './helpers/test-app'
import { LedgerService } from '../src/ledger/ledger.service'
import type { PrismaService } from '../src/prisma/prisma.service'

// Currency conversion (Part 32) — real ledger movement, priced from real
// MarketDataService quotes. BTC/USDT's real seed config uses provider
// BINANCE (a genuine outbound call); every test here overrides it to
// SIMULATED first so the suite is deterministic and never depends on live
// network access, exactly like options-trading.e2e-spec.ts's own
// setupOptionMarket() does for the same reason.
describe('Currency Conversion (real PostgreSQL, SimulatedProvider)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let ledger: LedgerService
  let server: any

  // Both real, shared MarketConfig rows are restored in afterAll (below) —
  // other e2e spec files in the same test run (e.g. market-data.e2e-spec.ts)
  // depend on their original seeded values and must never observe this
  // suite's temporary override.
  let originalBtcConfig: { dataSource: MarketDataSource; provider: string | null; providerSymbol: string | null; enabled: boolean; tradingEnabled: boolean }
  let originalEthConfig: { provider: string | null; providerSymbol: string | null }

  beforeAll(async () => {
    const t = await createTestApp()
    app = t.app
    prisma = t.prisma
    server = app.getHttpServer()
    ledger = app.get(LedgerService)

    const btc = await prisma.marketConfig.findUniqueOrThrow({ where: { symbol: 'BTC/USDT' } })
    originalBtcConfig = { dataSource: btc.dataSource, provider: btc.provider, providerSymbol: btc.providerSymbol, enabled: btc.enabled, tradingEnabled: btc.tradingEnabled }
    const eth = await prisma.marketConfig.findUniqueOrThrow({ where: { symbol: 'ETH/USDT' } })
    originalEthConfig = { provider: eth.provider, providerSymbol: eth.providerSymbol }

    await prisma.marketConfig.update({
      where: { symbol: 'BTC/USDT' },
      data: { dataSource: 'SIMULATED', provider: 'SIMULATED', providerSymbol: 'BTCUSDT', enabled: true, tradingEnabled: true },
    })
    // Deliberately left BROKEN (no provider) to prove an unavailable quote
    // rejects the conversion rather than fabricating a rate.
    await prisma.marketConfig.update({
      where: { symbol: 'ETH/USDT' },
      data: { provider: null, providerSymbol: null },
    })
  })

  afterAll(async () => {
    await prisma.marketConfig.update({ where: { symbol: 'BTC/USDT' }, data: originalBtcConfig })
    await prisma.marketConfig.update({ where: { symbol: 'ETH/USDT' }, data: originalEthConfig })
    await app.close()
  })

  async function registerAndLogin(prefix: string) {
    const email = uniqueEmail(prefix)
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, fullName: 'Convert Test' })
    const res = await request(server).post('/auth/login').send({ email, password }).expect(200)
    return { userId: user.id, cookie: extractSessionCookie(res) }
  }

  async function grantAsset(userId: string, currency: string, amount: string) {
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const { cash } = await ledger.getOrCreateUserLedgerAccounts(account.id, currency)
    const revenue = await ledger.getSystemLedgerAccount('REVENUE', currency)
    await ledger.postTransaction({
      description: 'convert test fixture asset grant',
      idempotencyKey: `convert-fixture-grant-${userId}-${currency}-${Date.now()}-${Math.random()}`,
      entries: [
        { ledgerAccountId: revenue.id, direction: 'DEBIT', amount, currency, entryType: 'ADJUSTMENT' },
        { ledgerAccountId: cash.id, direction: 'CREDIT', amount, currency, entryType: 'ADJUSTMENT' },
      ],
    })
  }

  it('converts USDT to BTC using a real live-quote-derived rate, and the response is self-consistent with what actually posted to the ledger', async () => {
    const { userId, cookie } = await registerAndLogin('convertusdtbtc')
    await grantAsset(userId, 'USDT', '1000')

    const res = await request(server).post('/accounts/me/convert').set('Cookie', cookie).send({ fromCurrency: 'USDT', toCurrency: 'BTC', amount: '100' }).expect(201)
    expect(res.body.fromAmount).toBe('100')
    expect(new Decimal(res.body.toAmount).gt(0)).toBe(true)

    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const usdt = await ledger.getAccountBalances(account.id, 'USDT')
    const btc = await ledger.getAccountBalances(account.id, 'BTC')
    expect(usdt.cash.toString()).toBe('900')
    // The response's reported toAmount must be exactly what actually landed
    // in the BTC ledger balance — never a display figure that diverges from
    // the real financial effect.
    expect(btc.cash.toString()).toBe(new Decimal(res.body.toAmount).toString())
  })

  it('rejects converting a currency to itself, zero ledger effect', async () => {
    const { userId, cookie } = await registerAndLogin('convertsame')
    await grantAsset(userId, 'USDT', '1000')
    const res = await request(server).post('/accounts/me/convert').set('Cookie', cookie).send({ fromCurrency: 'USDT', toCurrency: 'USDT', amount: '10' }).expect(400)
    expect(res.body.message).toMatch(/different currencies/i)

    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const usdt = await ledger.getAccountBalances(account.id, 'USDT')
    expect(usdt.cash.toString()).toBe('1000')
  })

  it('rejects a non-positive amount', async () => {
    const { cookie } = await registerAndLogin('convertbadamount')
    await request(server).post('/accounts/me/convert').set('Cookie', cookie).send({ fromCurrency: 'USDT', toCurrency: 'BTC', amount: '0' }).expect(400)
    await request(server).post('/accounts/me/convert').set('Cookie', cookie).send({ fromCurrency: 'USDT', toCurrency: 'BTC', amount: '-5' }).expect(400)
  })

  it('rejects a currency this feature does not support, before ever touching the ledger — never invents a rate for an unlisted currency', async () => {
    const { cookie } = await registerAndLogin('convertunsupported')
    await request(server).post('/accounts/me/convert').set('Cookie', cookie).send({ fromCurrency: 'USDT', toCurrency: 'XAU', amount: '10' }).expect(400)
  })

  it('insufficient balance is rejected with zero ledger effect', async () => {
    const { userId, cookie } = await registerAndLogin('convertinsufficient')
    await grantAsset(userId, 'USDT', '10')
    await request(server).post('/accounts/me/convert').set('Cookie', cookie).send({ fromCurrency: 'USDT', toCurrency: 'BTC', amount: '100' }).expect(400)

    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const usdt = await ledger.getAccountBalances(account.id, 'USDT')
    const btc = await ledger.getAccountBalances(account.id, 'BTC')
    expect(usdt.cash.toString()).toBe('10')
    expect(btc.cash.toString()).toBe('0')
  })

  it('an unavailable market quote rejects the conversion — never fabricates a rate when the real price is unavailable', async () => {
    const { userId, cookie } = await registerAndLogin('convertunavailable')
    await grantAsset(userId, 'USDT', '1000')
    const res = await request(server).post('/accounts/me/convert').set('Cookie', cookie).send({ fromCurrency: 'USDT', toCurrency: 'ETH', amount: '10' }).expect(400)
    expect(res.body.message).toMatch(/not currently available/i)

    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const usdt = await ledger.getAccountBalances(account.id, 'USDT')
    expect(usdt.cash.toString()).toBe('1000') // untouched
  })

  it('replays the same idempotency key without posting a second conversion', async () => {
    const { userId, cookie } = await registerAndLogin('convertidem')
    await grantAsset(userId, 'USDT', '1000')
    const key = `convert-idem-${Date.now()}`

    const first = await request(server).post('/accounts/me/convert').set('Cookie', cookie).set('Idempotency-Key', key).send({ fromCurrency: 'USDT', toCurrency: 'BTC', amount: '100' }).expect(201)
    const second = await request(server).post('/accounts/me/convert').set('Cookie', cookie).set('Idempotency-Key', key).send({ fromCurrency: 'USDT', toCurrency: 'BTC', amount: '100' }).expect(201)
    expect(second.body.transactionId).toBe(first.body.transactionId)

    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const usdt = await ledger.getAccountBalances(account.id, 'USDT')
    expect(usdt.cash.toString()).toBe('900') // debited exactly once, not twice
  })

  it("requires authentication", async () => {
    await request(server).post('/accounts/me/convert').send({ fromCurrency: 'USDT', toCurrency: 'BTC', amount: '10' }).expect(401)
  })
})
