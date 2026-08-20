import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect } from './helpers/test-app'
import { LedgerService } from '../src/ledger/ledger.service'
import { DepositsService } from '../src/deposits/deposits.service'
import { FakeExecutionProvider } from '../src/execution/providers/fake-execution.provider'
import { EXECUTION_PROVIDER } from '../src/execution/execution.module'
import type { PrismaService } from '../src/prisma/prisma.service'

// USDT Primary Spot Currency checkpoint — this file does NOT introduce any
// new currency mechanism. Every check below exercises the SAME generic,
// already-currency-aware risk engine / ledger / settlement / deposit-confirm
// code paths that spot-execution.e2e-spec.ts, risk-engine.e2e-spec.ts, and
// crypto-deposits.e2e-spec.ts already exercise with arbitrary currencies —
// it just asserts the literal string "USDT" explicitly, since no existing
// test named it verbatim, and adds one currency-ISOLATION test (USD must
// never satisfy a USDT requirement) that wasn't covered anywhere before.
describe('USDT as the primary CRYPTO_SPOT funding/quote currency (real PostgreSQL, FakeExecutionProvider)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let ledger: LedgerService
  let deposits: DepositsService
  let fake: FakeExecutionProvider
  let server: any

  beforeAll(async () => {
    const t = await createTestApp()
    app = t.app
    prisma = t.prisma
    server = app.getHttpServer()
    ledger = app.get(LedgerService)
    deposits = app.get(DepositsService)
    fake = app.get(FakeExecutionProvider)
  })

  afterAll(async () => {
    await app.close()
  })

  async function registerAndLogin(prefix: string) {
    const email = uniqueEmail(prefix)
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, fullName: 'USDT Primary Currency Test' })
    const res = await request(server).post('/auth/login').send({ email, password }).expect(200)
    return { userId: user.id, cookie: extractSessionCookie(res) }
  }

  async function grantAsset(userId: string, currency: string, amount: string) {
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const { cash } = await ledger.getOrCreateUserLedgerAccounts(account.id, currency)
    const revenue = await ledger.getSystemLedgerAccount('REVENUE', currency)
    await ledger.postTransaction({
      description: 'test fixture asset grant',
      idempotencyKey: `usdt-primary-grant-${userId}-${currency}-${Date.now()}-${Math.random()}`,
      entries: [
        { ledgerAccountId: revenue.id, direction: 'DEBIT', amount, currency, entryType: 'ADJUSTMENT' },
        { ledgerAccountId: cash.id, direction: 'CREDIT', amount, currency, entryType: 'ADJUSTMENT' },
      ],
    })
    return account.id
  }

  let marketSeq = 0
  async function setupUsdtMarket(baseAsset: string, price: string) {
    marketSeq += 1
    const providerSymbol = `${baseAsset}USDT`
    const symbol = `UPC${marketSeq}-${baseAsset}/USDT-${Date.now()}`
    await prisma.marketConfig.create({
      data: {
        symbol, dataSource: 'LIVE', tradingEnabled: true, maintenanceMode: false,
        baseAsset, quoteAsset: 'USDT', displayName: symbol, marketType: 'CRYPTO_SPOT',
        enabled: true, provider: 'BINANCE', providerSymbol,
      },
    })
    fake.configureSymbol(providerSymbol, { status: 'TRADING', baseAsset, quoteAsset: 'USDT' })
    fake.setSimulatedPrice(providerSymbol, price)
    return symbol
  }

  async function balancesOf(userId: string, currency: string) {
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    return ledger.getAccountBalances(account.id, currency)
  }

  it('sanity: resolves to the injected FakeExecutionProvider, never a real provider', () => {
    expect(app.get(EXECUTION_PROVIDER)).toBe(fake)
  })

  // ---- TEST 1/6. sufficient USDT -> order fills, USDT decreases, BTC credited ----

  it('TEST 1/6. a user with 6,000 USDT can submit a 100 USDT BTC/USDT order, which fills, decreasing USDT and crediting BTC', async () => {
    const symbol = await setupUsdtMarket('BTC', '61000')
    const { userId, cookie } = await registerAndLogin('usdtsufficient')
    await grantAsset(userId, 'USDT', '6000')

    const before = await balancesOf(userId, 'USDT')
    const order = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100' }).expect(201)
    expect(order.body.status).toBe('FILLED')

    const afterUsdt = await balancesOf(userId, 'USDT')
    const afterBtc = await balancesOf(userId, 'BTC')
    expect(afterUsdt.total.lt(before.total)).toBe(true) // USDT decreased
    expect(afterUsdt.total.toString()).not.toBe('0') // did not drain the whole 6000 for a 100 order
    expect(afterBtc.total.gt(0)).toBe(true) // BTC credited
  })

  // ---- TEST 2. zero USDT -> order blocked -----------------------------------

  it('TEST 2. a user with 0 USDT cannot submit a 100 USDT BTC/USDT order', async () => {
    const symbol = await setupUsdtMarket('BTC', '61000')
    const { cookie } = await registerAndLogin('usdtzero')

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100' }).expect(201)
    expect(res.body.status).toBe('REJECTED')
    expect(res.body.rejectionReason).toMatch(/USDT/)
  })

  // ---- TEST 3. USD balance must NOT satisfy a USDT requirement ---------------

  it('TEST 3. a user with 10,000 USD (but 0 USDT) cannot submit a 100 USDT BTC/USDT order — currencies are never treated as interchangeable', async () => {
    const symbol = await setupUsdtMarket('BTC', '61000')
    const { userId, cookie } = await registerAndLogin('usdvsusdt')
    await grantAsset(userId, 'USD', '10000') // plenty of USD, deliberately zero USDT

    const usd = await balancesOf(userId, 'USD')
    expect(usd.cash.toString()).toBe('10000') // confirm the USD grant really landed

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100' }).expect(201)
    expect(res.body.status).toBe('REJECTED')
    expect(res.body.rejectionReason).toMatch(/USDT/)

    const usdtAfter = await balancesOf(userId, 'USDT')
    expect(usdtAfter.cash.toString()).toBe('0') // the USD balance was never touched/converted
  })

  // ---- TEST 4. approved USDT crypto deposit credits USDT, not USD -----------

  it('TEST 4. an approved 500 USDT crypto deposit produces +500 USDT in the user\'s ledger, never USD', async () => {
    const { userId, cookie } = await registerAndLogin('usdtdeposit')
    const { user: admin } = await createUserDirect(prisma, { email: uniqueEmail('usdtdepositadmin'), password: 'correct-horse-battery', role: 'SUPER_ADMIN' })
    const adminId = admin.id

    // Reuse the seeded 'USDT' CryptoAsset row (created disabled, no network,
    // by prisma/seed.ts) rather than creating a duplicate — enable it and
    // attach a network the same way an admin would via the existing
    // step-up-gated flow, just direct-via-Prisma for test setup speed
    // (the HTTP admin path itself is already covered by crypto-deposits.e2e-spec.ts).
    const usdtAsset = await prisma.cryptoAsset.upsert({
      where: { symbol: 'USDT' },
      update: { enabled: true },
      create: { symbol: 'USDT', name: 'Tether', enabled: true },
    })
    const network = await prisma.cryptoDepositAddress.upsert({
      where: { cryptoAssetId_networkCode: { cryptoAssetId: usdtAsset.id, networkCode: 'TRC20' } },
      update: { enabled: true, receivingAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
      create: { cryptoAssetId: usdtAsset.id, networkCode: 'TRC20', networkName: 'Tron (TRC20)', enabled: true, receivingAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
    })
    void network

    const before = await balancesOf(userId, 'USDT')
    const created = await request(server).post('/deposits').set('Cookie', cookie)
      .send({ method: 'CRYPTO', cryptoAssetSymbol: 'USDT', networkCode: 'TRC20', amount: '500' })
      .expect(201)
    expect(created.body.currency).toBe('USDT') // deposit itself is denominated in USDT, never USD

    await deposits.confirm(created.body.id, adminId, 'usdt primary currency test approval')

    const afterUsdt = await balancesOf(userId, 'USDT')
    const afterUsd = await balancesOf(userId, 'USD')
    expect(afterUsdt.cash.minus(before.cash).toString()).toBe('500')
    expect(afterUsd.cash.toString()).toBe('0') // no fiat conversion, no USD side-effect
  })

  // ---- TEST 5. reservation itself is posted in USDT --------------------------

  it('TEST 5. the trade reservation ledger entries for a BTC/USDT order are posted in USDT', async () => {
    const symbol = await setupUsdtMarket('BTC', '61000')
    const { userId, cookie } = await registerAndLogin('usdtreservation')
    await grantAsset(userId, 'USDT', '6000')

    const order = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100' }).expect(201)
    expect(order.body.status).toBe('FILLED')

    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const reservationEntries = await prisma.ledgerEntry.findMany({
      where: { entryType: 'TRADE_RESERVATION', ledgerAccount: { accountId: account.id } },
    })
    expect(reservationEntries.length).toBeGreaterThan(0)
    for (const e of reservationEntries) expect(e.currency).toBe('USDT')
  })

  // ---- TEST 7. Spot Holdings reflects the resulting USDT/BTC ledger balances -

  it('TEST 7. GET /accounts/me/assets reflects the exact post-trade USDT and BTC ledger balances', async () => {
    const symbol = await setupUsdtMarket('BTC', '61000')
    const { userId, cookie } = await registerAndLogin('usdtholdings')
    await grantAsset(userId, 'USDT', '6000')

    await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100' }).expect(201)

    const ledgerUsdt = await balancesOf(userId, 'USDT')
    const ledgerBtc = await balancesOf(userId, 'BTC')
    const res = await request(server).get('/accounts/me/assets').set('Cookie', cookie).expect(200)
    const usdtRow = res.body.find((a: any) => a.currency === 'USDT')
    const btcRow = res.body.find((a: any) => a.currency === 'BTC')
    expect(usdtRow.total).toBe(ledgerUsdt.total.toString())
    expect(btcRow.total).toBe(ledgerBtc.total.toString())
  })

  // ---- TEST 8. cross-user USDT isolation --------------------------------------

  it('TEST 8. two different users cannot access or use another user\'s USDT balance', async () => {
    const a = await registerAndLogin('usdtusera')
    await grantAsset(a.userId, 'USDT', '9999')
    const b = await registerAndLogin('usdtuserb')
    await grantAsset(b.userId, 'USDT', '1')

    const resA = await request(server).get('/accounts/me/balance?currency=USDT').set('Cookie', a.cookie).expect(200)
    const resB = await request(server).get('/accounts/me/balance?currency=USDT').set('Cookie', b.cookie).expect(200)
    expect(resA.body.cash).toBe('9999')
    expect(resB.body.cash).toBe('1')

    // B cannot spend more USDT than B actually has, even though A has plenty
    const symbol = await setupUsdtMarket('BTC', '61000')
    const res = await request(server).post('/orders').set('Cookie', b.cookie).send({ symbol, side: 'BUY', quantity: '100' }).expect(201)
    expect(res.body.status).toBe('REJECTED')
  })
})
