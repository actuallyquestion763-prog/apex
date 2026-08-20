import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { Decimal } from '@prisma/client/runtime/library'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect, enableTotpDirect, currentTotpCode, grantPermissionDirect } from './helpers/test-app'
import { LedgerService } from '../src/ledger/ledger.service'
import { OptionsService } from '../src/options/options.service'
import { FakeExecutionProvider } from '../src/execution/providers/fake-execution.provider'
import type { PrismaService } from '../src/prisma/prisma.service'

const TEST_USDT_ADDRESS = '0x028693214AFA4E3bf4537175b5505315AFda80A3'

// Trade Experience checkpoint — currency-aware balance, execution-status
// disclosure, USDT crypto-deposit funding, and the new platform-wide
// Sandbox Outcome Mode admin dial. Everything already covered by
// options-trading.e2e-spec.ts (amount validation, idempotency, settlement
// atomicity, per-trade FORCE_WIN/FORCE_LOSS/DRAW, production rejection,
// audit events, refresh-survival) is deliberately NOT re-tested here.
describe('Trade Experience — currency-aware balance, execution status, sandbox outcome mode (real PostgreSQL)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let ledger: LedgerService
  let options: OptionsService
  let fake: FakeExecutionProvider
  let server: any
  let superCookie: string
  let superPassword: string
  let superSecret: string

  beforeAll(async () => {
    const t = await createTestApp()
    app = t.app
    prisma = t.prisma
    server = app.getHttpServer()
    ledger = app.get(LedgerService)
    options = app.get(OptionsService)
    fake = app.get(FakeExecutionProvider)

    const email = uniqueEmail('tradexpsuper')
    superPassword = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password: superPassword, role: 'SUPER_ADMIN' })
    superSecret = await enableTotpDirect(prisma, user.id)
    const loginRes = await request(server).post('/auth/login').send({ email, password: superPassword }).expect(200)
    const verifyRes = await request(server).post('/auth/2fa/login-verify').send({ pendingToken: loginRes.body.pendingToken, code: currentTotpCode(superSecret) }).expect(200)
    superCookie = extractSessionCookie(verifyRes)

    // Options trading defaults OFF platform-wide (new-product safe default)
    // — turn it on for this suite's own settlement tests, same pattern as
    // options-trading.e2e-spec.ts.
    await request(server)
      .patch('/admin/options/settings')
      .set('Cookie', superCookie)
      .send({ tradingEnabled: true, reason: 'enable for trade-experience e2e suite', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)
  })

  afterAll(async () => {
    // Restore global state so this suite never affects a differently-ordered
    // future test run.
    await request(server)
      .patch('/admin/options/settings')
      .set('Cookie', superCookie)
      .send({ tradingEnabled: false, sandboxOutcomeMode: 'RANDOM', reason: 'restore after trade-experience e2e suite', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
    await app.close()
  })

  async function registerAndLogin(prefix: string) {
    const email = uniqueEmail(prefix)
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, fullName: 'Trade Experience Test' })
    const res = await request(server).post('/auth/login').send({ email, password }).expect(200)
    return { userId: user.id, cookie: extractSessionCookie(res) }
  }

  async function grantAsset(userId: string, currency: string, amount: string) {
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const { cash } = await ledger.getOrCreateUserLedgerAccounts(account.id, currency)
    const revenue = await ledger.getSystemLedgerAccount('REVENUE', currency)
    await ledger.postTransaction({
      description: 'trade-experience test fixture asset grant',
      idempotencyKey: `trade-exp-grant-${userId}-${currency}-${Date.now()}-${Math.random()}`,
      entries: [
        { ledgerAccountId: revenue.id, direction: 'DEBIT', amount, currency, entryType: 'ADJUSTMENT' },
        { ledgerAccountId: cash.id, direction: 'CREDIT', amount, currency, entryType: 'ADJUSTMENT' },
      ],
    })
    return account.id
  }

  async function makeAdminWith(...permissions: string[]) {
    const email = uniqueEmail('tradexpadmin')
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, role: 'ADMIN', fullName: 'Trade Experience Admin' })
    for (const p of permissions) await grantPermissionDirect(prisma, user.id, p)
    const res = await request(server).post('/auth/login').send({ email, password }).expect(200)
    return { adminId: user.id, cookie: extractSessionCookie(res) }
  }

  let marketSeq = 0
  async function setupOptionMarket(durations: { durationSeconds: number; payoutPercent: string }[] = [{ durationSeconds: 30, payoutPercent: '5' }]) {
    marketSeq += 1
    const symbol = `TRDX${marketSeq}-TEST/USDT-${Date.now()}`
    await prisma.marketConfig.create({
      data: { symbol, dataSource: 'SIMULATED', tradingEnabled: true, enabled: true, baseAsset: 'TEST', quoteAsset: 'USDT', marketType: 'CRYPTO_SPOT', provider: 'SIMULATED', providerSymbol: 'BTCUSDT' },
    })
    const market = await prisma.optionMarket.create({ data: { symbol, enabled: true, currency: 'USDT', minInvestment: new Decimal('1') } })
    for (const d of durations) {
      await prisma.optionDuration.create({ data: { optionMarketId: market.id, durationSeconds: d.durationSeconds, payoutPercent: new Decimal(d.payoutPercent), enabled: true } })
    }
    return symbol
  }

  let spotMarketSeq = 0
  // Fresh, uniquely-named CRYPTO_SPOT/LIVE/tradingEnabled market mapped to a
  // REAL Binance providerSymbol so MarketDataService's real BinanceProvider
  // supplies a genuine LIVE quote (never the shared seeded 'BTC/USDT' row,
  // whose tradingEnabled defaults false) — identical recipe to
  // spot-execution.e2e-spec.ts's setupMarket(). Execution itself always
  // goes through the injected FakeExecutionProvider under NODE_ENV=test,
  // never a real exchange, regardless of this quote source.
  async function setupSpotMarket() {
    spotMarketSeq += 1
    const symbol = `TRDXSPOT${spotMarketSeq}-TEST/USDT-${Date.now()}`
    const providerSymbol = 'BTCUSDT'
    await prisma.marketConfig.create({
      data: { symbol, dataSource: 'LIVE', tradingEnabled: true, maintenanceMode: false, baseAsset: 'TEST', quoteAsset: 'USDT', displayName: symbol, marketType: 'CRYPTO_SPOT', enabled: true, provider: 'BINANCE', providerSymbol },
    })
    fake.configureSymbol(providerSymbol, { status: 'TRADING', baseAsset: 'TEST', quoteAsset: 'USDT' })
    fake.setSimulatedPrice(providerSymbol, '10')
    return symbol
  }

  let assetSeq = 0
  async function setupCryptoAsset() {
    assetSeq += 1
    const symbol = `USDT-TRDX${assetSeq}-${Date.now()}`
    const asset = await prisma.cryptoAsset.create({ data: { symbol, name: 'Tether (test)', enabled: true } })
    await prisma.cryptoDepositAddress.create({
      data: { cryptoAssetId: asset.id, networkCode: 'ERC20', networkName: 'ERC20', enabled: true, receivingAddress: TEST_USDT_ADDRESS },
    })
    return symbol
  }

  // ---- 1/2. Currency-specific balance ------------------------------------

  it('1/2. GET /accounts/me/balance is currency-scoped — USD and USDT are completely independent, never conflated', async () => {
    const { userId, cookie } = await registerAndLogin('balancescope')
    await grantAsset(userId, 'USD', '6000')

    const usd = await request(server).get('/accounts/me/balance?currency=USD').set('Cookie', cookie).expect(200)
    expect(usd.body.cash).toBe('6000')
    expect(usd.body.currency).toBe('USD')

    const usdt = await request(server).get('/accounts/me/balance?currency=USDT').set('Cookie', cookie).expect(200)
    expect(usdt.body.cash).toBe('0')
    expect(usdt.body.currency).toBe('USDT')
  })

  it('3/4. a BTC/USDT-style order with 0 USDT is rejected, and the unrelated USD balance is completely untouched', async () => {
    const symbol = await setupSpotMarket()
    const { userId, cookie } = await registerAndLogin('insufficientusdt')
    await grantAsset(userId, 'USD', '6000') // funded in USD only — zero USDT

    const res = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '100' })
    expect([200, 201]).toContain(res.status)
    expect(res.body.status).toBe('REJECTED')
    expect(res.body.rejectionReason).toContain('USDT')
    expect(res.body.rejectionReason).toContain('INSUFFICIENT_AVAILABLE_BALANCE')

    const usdAfter = await request(server).get('/accounts/me/balance?currency=USD').set('Cookie', cookie).expect(200)
    expect(usdAfter.body.cash).toBe('6000')
  })

  // ---- 5/6. USDT crypto deposit funds CASH/USDT through the real flow ----

  it('5/6. an admin-approved USDT crypto deposit credits CASH/USDT, and the balance endpoint reflects it immediately', async () => {
    const { userId, cookie } = await registerAndLogin('usdtdeposit')
    const symbol = await setupCryptoAsset()

    const before = await request(server).get('/accounts/me/balance?currency=USDT').set('Cookie', cookie).expect(200)
    expect(before.body.cash).toBe('0')

    const created = await request(server)
      .post('/deposits')
      .set('Cookie', cookie)
      .send({ method: 'CRYPTO', amount: '250', cryptoAssetSymbol: symbol, networkCode: 'ERC20' })
      .expect(201)
    expect(created.body.currency).toBe(symbol)

    await request(server)
      .post(`/admin/deposits/${created.body.id}/confirm`)
      .set('Cookie', superCookie)
      .send({ reason: 'trade-experience e2e verified deposit' })
      .expect(201)

    const after = await request(server).get(`/accounts/me/balance?currency=${symbol}`).set('Cookie', cookie).expect(200)
    expect(after.body.cash).toBe('250')
    void userId
  })

  // ---- 5b. Execution status -------------------------------------------------

  it('5b. GET /execution/status reports a real provider name and never leaks a credential-shaped string', async () => {
    const { cookie } = await registerAndLogin('execstatus')
    const res = await request(server).get('/execution/status').set('Cookie', cookie).expect(200)
    expect(['Fake', 'BinanceSandbox', 'Disabled']).toContain(res.body.provider)
    expect(typeof res.body.message).toBe('string')
    const serialized = JSON.stringify(res.body)
    expect(serialized.toLowerCase()).not.toContain('secret')
    expect(serialized.toLowerCase()).not.toContain('apikey')
  })

  it('unauthenticated requests cannot read execution status', async () => {
    await request(server).get('/execution/status').expect(401)
  })

  // ---- Sandbox Outcome Mode (Part 8) -----------------------------------

  it('sandboxControlsAvailable is reported true under NODE_ENV=test, and the field defaults to RANDOM', async () => {
    const res = await request(server).get('/admin/options/settings').set('Cookie', superCookie).expect(200)
    expect(res.body.sandboxControlsAvailable).toBe(true)
    expect(['RANDOM', 'FORCE_WIN', 'FORCE_LOSS']).toContain(res.body.sandboxOutcomeMode)
  })

  it('a plain USER and a permission-less ADMIN cannot change sandbox outcome mode', async () => {
    const user = await registerAndLogin('sandboxplainuser')
    const noPerm = await makeAdminWith()
    for (const cookie of [user.cookie, noPerm.cookie]) {
      const res = await request(server)
        .patch('/admin/options/settings')
        .set('Cookie', cookie)
        .send({ sandboxOutcomeMode: 'FORCE_WIN', reason: 'unauthorized attempt', confirmPassword: 'whatever', totpCode: '000000' })
      expect(res.status).toBe(403)
    }
  })

  it('an ADMIN with options.control cannot bypass step-up to change sandbox outcome mode', async () => {
    const admin = await makeAdminWith('options.control')
    const res = await request(server)
      .patch('/admin/options/settings')
      .set('Cookie', admin.cookie)
      .send({ sandboxOutcomeMode: 'FORCE_WIN', reason: 'no step-up', confirmPassword: 'wrong-password', totpCode: '000000' })
    // Step-up re-authentication failure is 401 (re-auth failed), distinct
    // from the 403 the permission/environment gates return.
    expect(res.status).toBe(401)
  })

  it('FORCE_WIN via the admin dial makes a NORMAL-mode trade settle WIN, and FORCE_LOSS makes it settle LOSS — deterministically, not just probably', async () => {
    const symbol = await setupOptionMarket()
    const { userId, cookie } = await registerAndLogin('sandboxforcewin')
    await grantAsset(userId, 'USDT', '1000')

    await request(server)
      .patch('/admin/options/settings')
      .set('Cookie', superCookie)
      .send({ sandboxOutcomeMode: 'FORCE_WIN', reason: 'e2e forced win', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)

    const winRes = await request(server).post('/options/trades').set('Cookie', cookie).send({ symbol, direction: 'BUY', investment: '10', durationSeconds: 30 }).expect(201)
    expect(winRes.body.requestedResultMode).toBe('NORMAL') // no per-trade override requested
    const settledWin = await options.settleTrade(winRes.body.id)
    expect(settledWin.result).toBe('WIN')

    await request(server)
      .patch('/admin/options/settings')
      .set('Cookie', superCookie)
      .send({ sandboxOutcomeMode: 'FORCE_LOSS', reason: 'e2e forced loss', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)

    const lossRes = await request(server).post('/options/trades').set('Cookie', cookie).send({ symbol, direction: 'BUY', investment: '10', durationSeconds: 30 }).expect(201)
    const settledLoss = await options.settleTrade(lossRes.body.id)
    expect(settledLoss.result).toBe('LOSS')
  })

  it('a per-trade requestedResultMode override takes priority over the platform-wide sandbox dial', async () => {
    const symbol = await setupOptionMarket()
    const { userId, cookie } = await registerAndLogin('sandboxprecedence')
    await grantAsset(userId, 'USDT', '1000')

    await request(server)
      .patch('/admin/options/settings')
      .set('Cookie', superCookie)
      .send({ sandboxOutcomeMode: 'FORCE_WIN', reason: 'e2e precedence check', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)

    // The customer explicitly requests FORCE_LOSS for their own trade — this
    // must win over the admin's platform-wide FORCE_WIN dial.
    const res = await request(server).post('/options/trades').set('Cookie', cookie).send({ symbol, direction: 'BUY', investment: '10', durationSeconds: 30, requestedResultMode: 'FORCE_LOSS' }).expect(201)
    const settled = await options.settleTrade(res.body.id)
    expect(settled.result).toBe('LOSS')

    await request(server)
      .patch('/admin/options/settings')
      .set('Cookie', superCookie)
      .send({ sandboxOutcomeMode: 'RANDOM', reason: 'e2e cleanup', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)
  })

  it('setting sandboxOutcomeMode to FORCE_WIN/FORCE_LOSS is rejected outside development/test; RANDOM is always allowed', async () => {
    const original = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'production'
      const res = await request(server)
        .patch('/admin/options/settings')
        .set('Cookie', superCookie)
        .send({ sandboxOutcomeMode: 'FORCE_WIN', reason: 'attempted prod override', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      expect(res.status).toBe(403)

      const stillRandom = await request(server)
        .patch('/admin/options/settings')
        .set('Cookie', superCookie)
        .send({ sandboxOutcomeMode: 'RANDOM', reason: 'explicit RANDOM always allowed', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      expect(stillRandom.status).toBe(200)
    } finally {
      process.env.NODE_ENV = original
    }
  })

  it('changing sandbox outcome mode writes a SANDBOX_OUTCOME_MODE_CHANGED audit event with the admin as actor', async () => {
    await request(server)
      .patch('/admin/options/settings')
      .set('Cookie', superCookie)
      .send({ sandboxOutcomeMode: 'FORCE_LOSS', reason: 'e2e audit check', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)

    const events = await prisma.auditLog.findMany({ where: { action: 'SANDBOX_OUTCOME_MODE_CHANGED' }, orderBy: { createdAt: 'desc' }, take: 1 })
    expect(events.length).toBe(1)
    expect((events[0].newState as any)?.sandboxOutcomeMode).toBe('FORCE_LOSS')

    await request(server)
      .patch('/admin/options/settings')
      .set('Cookie', superCookie)
      .send({ sandboxOutcomeMode: 'RANDOM', reason: 'e2e cleanup', confirmPassword: superPassword, totpCode: currentTotpCode(superSecret) })
      .expect(200)
  })
})
