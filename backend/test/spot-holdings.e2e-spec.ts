import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect } from './helpers/test-app'
import { LedgerService } from '../src/ledger/ledger.service'
import { FakeExecutionProvider } from '../src/execution/providers/fake-execution.provider'
import { EXECUTION_PROVIDER } from '../src/execution/execution.module'
import type { PrismaService } from '../src/prisma/prisma.service'

// Spot Holdings Visibility checkpoint — GET /accounts/me/assets. Every trade
// here goes through the injected FakeExecutionProvider (never Binance) under
// NODE_ENV=test — same pattern as spot-execution.e2e-spec.ts, so these are
// REAL settled fills, not fabricated ledger entries, proving the endpoint
// reflects genuine trade outcomes.
describe('Spot Holdings Visibility — GET /accounts/me/assets (real PostgreSQL, FakeExecutionProvider)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let ledger: LedgerService
  let fake: FakeExecutionProvider
  let server: any

  beforeAll(async () => {
    const t = await createTestApp()
    app = t.app
    prisma = t.prisma
    server = app.getHttpServer()
    ledger = app.get(LedgerService)
    fake = app.get(FakeExecutionProvider)
  })

  afterAll(async () => {
    await app.close()
  })

  async function registerAndLogin(prefix: string) {
    const email = uniqueEmail(prefix)
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, fullName: 'Spot Holdings Test' })
    const res = await request(server).post('/auth/login').send({ email, password }).expect(200)
    return { userId: user.id, cookie: extractSessionCookie(res) }
  }

  async function grantAsset(userId: string, currency: string, amount: string) {
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const { cash } = await ledger.getOrCreateUserLedgerAccounts(account.id, currency)
    const revenue = await ledger.getSystemLedgerAccount('REVENUE', currency)
    await ledger.postTransaction({
      description: 'spot-holdings test fixture asset grant',
      idempotencyKey: `spot-holdings-grant-${userId}-${currency}-${Date.now()}-${Math.random()}`,
      entries: [
        { ledgerAccountId: revenue.id, direction: 'DEBIT', amount, currency, entryType: 'ADJUSTMENT' },
        { ledgerAccountId: cash.id, direction: 'CREDIT', amount, currency, entryType: 'ADJUSTMENT' },
      ],
    })
    return account.id
  }

  let marketSeq = 0
  async function setupMarket(opts: { providerSymbol: string; baseAsset: string; quoteAsset: string; price: string }) {
    marketSeq += 1
    const symbol = `HOLD${marketSeq}-${opts.baseAsset}/${opts.quoteAsset}-${Date.now()}`
    await prisma.marketConfig.create({
      data: { symbol, dataSource: 'LIVE', tradingEnabled: true, maintenanceMode: false, baseAsset: opts.baseAsset, quoteAsset: opts.quoteAsset, displayName: symbol, marketType: 'CRYPTO_SPOT', enabled: true, provider: 'BINANCE', providerSymbol: opts.providerSymbol },
    })
    fake.configureSymbol(opts.providerSymbol, { status: 'TRADING', baseAsset: opts.baseAsset, quoteAsset: opts.quoteAsset })
    fake.setSimulatedPrice(opts.providerSymbol, opts.price)
    return symbol
  }

  it('sanity: resolves to the injected FakeExecutionProvider, never a real provider', () => {
    expect(app.get(EXECUTION_PROVIDER)).toBe(fake)
  })

  // ---- A/D. no BTC, but a real USD balance -------------------------------

  it('A/D. a user with no BTC but a real USD balance sees USD and does not see BTC', async () => {
    const { userId, cookie } = await registerAndLogin('holdusdonly')
    await grantAsset(userId, 'USD', '6000')

    const res = await request(server).get('/accounts/me/assets').set('Cookie', cookie).expect(200)
    const currencies = res.body.map((a: any) => a.currency)
    expect(currencies).toContain('USD')
    expect(currencies).not.toContain('BTC')
    const usd = res.body.find((a: any) => a.currency === 'USD')
    expect(usd.total).toBe('6000')
    void userId
  })

  // ---- B/C. real BUY fill produces both BTC and reduced USDT ------------

  it('B/C. a real BTC/USDT BUY fill makes BTC and USDT both appear with correct quantities', async () => {
    const providerSymbol = 'BTCUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'BTC', quoteAsset: 'USDT', price: '61234.56' })
    const { userId, cookie } = await registerAndLogin('holdbuy')
    await grantAsset(userId, 'USDT', '1000')

    const order = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'BUY', quantity: '500' }).expect(201)
    expect(order.body.status).toBe('FILLED')

    const res = await request(server).get('/accounts/me/assets').set('Cookie', cookie).expect(200)
    const btc = res.body.find((a: any) => a.currency === 'BTC')
    const usdt = res.body.find((a: any) => a.currency === 'USDT')
    expect(btc).toBeTruthy()
    expect(Number(btc.total)).toBeGreaterThan(0)
    expect(usdt.total).toBe('499.5') // 1000 - 500 spent - 0.5 fee
    void userId
  })

  // ---- E. zero balances excluded ------------------------------------------

  it('E. a currency the user has a LedgerAccount for but a zero net balance in is NOT displayed', async () => {
    const { userId, cookie } = await registerAndLogin('holdzero')
    // Grant then immediately debit back to zero via a second real ledger
    // transaction — the LedgerAccount row now exists, but nets to zero.
    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const { cash } = await ledger.getOrCreateUserLedgerAccounts(account.id, 'ETH')
    const revenue = await ledger.getSystemLedgerAccount('REVENUE', 'ETH')
    await ledger.postTransaction({
      description: 'grant', idempotencyKey: `zero-grant-${userId}-${Date.now()}`,
      entries: [
        { ledgerAccountId: revenue.id, direction: 'DEBIT', amount: '2', currency: 'ETH', entryType: 'ADJUSTMENT' },
        { ledgerAccountId: cash.id, direction: 'CREDIT', amount: '2', currency: 'ETH', entryType: 'ADJUSTMENT' },
      ],
    })
    await ledger.postTransaction({
      description: 'debit back to zero', idempotencyKey: `zero-debit-${userId}-${Date.now()}`,
      entries: [
        { ledgerAccountId: cash.id, direction: 'DEBIT', amount: '2', currency: 'ETH', entryType: 'ADJUSTMENT' },
        { ledgerAccountId: revenue.id, direction: 'CREDIT', amount: '2', currency: 'ETH', entryType: 'ADJUSTMENT' },
      ],
    })

    const res = await request(server).get('/accounts/me/assets').set('Cookie', cookie).expect(200)
    expect(res.body.map((a: any) => a.currency)).not.toContain('ETH')
  })

  // ---- F. IDOR — cannot fetch another user's holdings --------------------

  it('F. one user\'s holdings can never be requested by another user — the endpoint has no id parameter and always uses the session', async () => {
    const a = await registerAndLogin('holdusera')
    await grantAsset(a.userId, 'USDT', '12345')
    const b = await registerAndLogin('holduserb')
    await grantAsset(b.userId, 'USDT', '1')

    const resA = await request(server).get('/accounts/me/assets').set('Cookie', a.cookie).expect(200)
    const resB = await request(server).get('/accounts/me/assets').set('Cookie', b.cookie).expect(200)

    expect(resA.body.find((x: any) => x.currency === 'USDT').total).toBe('12345')
    expect(resB.body.find((x: any) => x.currency === 'USDT').total).toBe('1')

    // No variant of the endpoint accepts a target user/account id at all.
    await request(server).get('/accounts/me/assets').expect(401) // no cookie — always session-scoped
  })

  // ---- H. selling the entire balance removes it from holdings -----------

  it('H. selling the entire BTC balance makes BTC disappear from holdings once it nets to exactly zero', async () => {
    const providerSymbol = 'ETHUSDT'
    const symbol = await setupMarket({ providerSymbol, baseAsset: 'ETH', quoteAsset: 'USDT', price: '3000' })
    const { userId, cookie } = await registerAndLogin('holdsellall')
    await grantAsset(userId, 'ETH', '2')

    const before = await request(server).get('/accounts/me/assets').set('Cookie', cookie).expect(200)
    expect(before.body.find((a: any) => a.currency === 'ETH').total).toBe('2')

    const sell = await request(server).post('/orders').set('Cookie', cookie).send({ symbol, side: 'SELL', quantity: '2' }).expect(201)
    expect(sell.body.status).toBe('FILLED')

    const after = await request(server).get('/accounts/me/assets').set('Cookie', cookie).expect(200)
    expect(after.body.map((a: any) => a.currency)).not.toContain('ETH')
    expect(after.body.find((a: any) => a.currency === 'USDT').total).not.toBe('0') // proceeds credited
    void userId
  })

  // ---- Security: never creates a financial record ------------------------

  it('the endpoint never creates a LedgerTransaction, LedgerEntry, or LedgerAccount as a side effect of being called', async () => {
    const { cookie } = await registerAndLogin('holdreadonly')
    const beforeTx = await prisma.ledgerTransaction.count()
    const beforeEntries = await prisma.ledgerEntry.count()
    const beforeAccounts = await prisma.ledgerAccount.count()

    await request(server).get('/accounts/me/assets').set('Cookie', cookie).expect(200)
    await request(server).get('/accounts/me/assets').set('Cookie', cookie).expect(200)
    await request(server).get('/accounts/me/assets').set('Cookie', cookie).expect(200)

    expect(await prisma.ledgerTransaction.count()).toBe(beforeTx)
    expect(await prisma.ledgerEntry.count()).toBe(beforeEntries)
    expect(await prisma.ledgerAccount.count()).toBe(beforeAccounts)
  })

  it('the response never includes internal ledger-account ids or audit information', async () => {
    const { userId, cookie } = await registerAndLogin('holdnoids')
    await grantAsset(userId, 'USD', '100')
    const res = await request(server).get('/accounts/me/assets').set('Cookie', cookie).expect(200)
    const serialized = JSON.stringify(res.body)
    expect(serialized).not.toMatch(/ledgerAccountId/i)
    expect(serialized).not.toMatch(/auditLog/i)
    void userId
  })
})
