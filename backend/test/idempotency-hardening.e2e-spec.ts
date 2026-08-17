import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect } from './helpers/test-app'
import { LedgerService } from '../src/ledger/ledger.service'
import type { PrismaService } from '../src/prisma/prisma.service'

// Phase 2.1 — proves the client-supplied Idempotency-Key mechanism
// (src/common/idempotency/idempotency.service.ts) and the system
// ledger-account race fix (LedgerService.getSystemLedgerAccount). Real
// PostgreSQL throughout, disposable test database only — never trust_dev.
describe('Idempotency & system-account race hardening (real PostgreSQL)', () => {
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
    const { user } = await createUserDirect(prisma, { email, password, fullName: 'Idempotency Test' })
    const res = await request(server).post('/auth/login').send({ email, password }).expect(200)
    return { email, password, userId: user.id, cookie: extractSessionCookie(res) }
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
  }

  // ---- 1 & 2: withdrawal, sequential and concurrent same-key retries ----

  it('1. the same withdrawal request + same Idempotency-Key sent twice, sequentially, produces exactly one Withdrawal row', async () => {
    const { userId, cookie } = await registerAndLogin('idemw1')
    await grantBalance(userId, '500')
    const key = `wkey-${Date.now()}`
    const body = { amount: '100', destination: 'wallet-A' }

    const r1 = await request(server).post('/withdrawals').set('Cookie', cookie).set('Idempotency-Key', key).send(body).expect(201)
    const r2 = await request(server).post('/withdrawals').set('Cookie', cookie).set('Idempotency-Key', key).send(body).expect(201)

    expect(r1.body.id).toBe(r2.body.id) // the retry replayed the original result, not a new record
    const count = await prisma.withdrawal.count({ where: { userId } })
    expect(count).toBe(1)

    const balances = await ledger.getAccountBalances((await prisma.account.findFirstOrThrow({ where: { userId } })).id)
    expect(balances.cash.toString()).toBe('400') // only ONE 100 reservation, not two
  })

  it('2. the same withdrawal request + same Idempotency-Key sent concurrently produces exactly one Withdrawal row and one reservation', async () => {
    const { userId, cookie } = await registerAndLogin('idemw2')
    await grantBalance(userId, '500')
    const key = `wkey-concurrent-${Date.now()}`
    const body = { amount: '150', destination: 'wallet-B' }

    const [r1, r2] = await Promise.all([
      request(server).post('/withdrawals').set('Cookie', cookie).set('Idempotency-Key', key).send(body),
      request(server).post('/withdrawals').set('Cookie', cookie).set('Idempotency-Key', key).send(body),
    ])
    expect(r1.status).toBe(201)
    expect(r2.status).toBe(201)
    expect(r1.body.id).toBe(r2.body.id)

    const count = await prisma.withdrawal.count({ where: { userId } })
    expect(count).toBe(1)
    const balances = await ledger.getAccountBalances((await prisma.account.findFirstOrThrow({ where: { userId } })).id)
    expect(balances.cash.toString()).toBe('350') // 500 - 150, exactly once
    expect(balances.cash.gte(0)).toBe(true)
  })

  // ---- 3: deposit, concurrent same-key ----

  it('3. the same deposit request + same Idempotency-Key sent concurrently produces exactly one Deposit row', async () => {
    const { userId, cookie } = await registerAndLogin('idemd1')
    const key = `dkey-concurrent-${Date.now()}`
    const body = { amount: '250', method: 'test' }

    const [r1, r2] = await Promise.all([
      request(server).post('/deposits').set('Cookie', cookie).set('Idempotency-Key', key).send(body),
      request(server).post('/deposits').set('Cookie', cookie).set('Idempotency-Key', key).send(body),
    ])
    expect(r1.status).toBe(201)
    expect(r2.status).toBe(201)
    expect(r1.body.id).toBe(r2.body.id)

    const count = await prisma.deposit.count({ where: { userId } })
    expect(count).toBe(1) // not two PENDING deposits that could both later be confirmed
  })

  // ---- 4: order, concurrent same-key ----

  it('4. the same order request + same Idempotency-Key sent concurrently produces exactly one Order row', async () => {
    const { userId, cookie } = await registerAndLogin('idemo1')
    await grantBalance(userId, '1000')
    await prisma.marketConfig.upsert({
      where: { symbol: 'IDEM/USD' },
      create: { symbol: 'IDEM/USD', dataSource: 'SIMULATED', tradingEnabled: true },
      update: { tradingEnabled: true },
    })
    const key = `okey-concurrent-${Date.now()}`
    const body = { symbol: 'IDEM/USD', side: 'BUY', quantity: '400' }

    const [r1, r2] = await Promise.all([
      request(server).post('/orders').set('Cookie', cookie).set('Idempotency-Key', key).send(body),
      request(server).post('/orders').set('Cookie', cookie).set('Idempotency-Key', key).send(body),
    ])
    expect(r1.status).toBe(201)
    expect(r2.status).toBe(201)
    expect(r1.body.id).toBe(r2.body.id)

    const count = await prisma.order.count({ where: { userId } })
    expect(count).toBe(1)

    // ledger stayed balanced and fully released (order always rejects — no broker)
    const balances = await ledger.getAccountBalances((await prisma.account.findFirstOrThrow({ where: { userId } })).id)
    expect(balances.cash.toString()).toBe('1000')
    expect(balances.reserved.toString()).toBe('0')
  })

  // ---- 5: same key, different params -> rejected ----

  it('5. reusing the same Idempotency-Key with materially different request parameters is rejected, not silently applied', async () => {
    const { userId, cookie } = await registerAndLogin('idemconflict')
    await grantBalance(userId, '1000')
    const key = `wkey-conflict-${Date.now()}`

    await request(server).post('/withdrawals').set('Cookie', cookie).set('Idempotency-Key', key).send({ amount: '100', destination: 'wallet-A' }).expect(201)

    // Same key, different amount — must NOT be treated as a replay, and must NOT create a second withdrawal.
    await request(server).post('/withdrawals').set('Cookie', cookie).set('Idempotency-Key', key).send({ amount: '999', destination: 'wallet-A' }).expect(409)

    const count = await prisma.withdrawal.count({ where: { userId } })
    expect(count).toBe(1) // only the first, legitimate request

    const balances = await ledger.getAccountBalances((await prisma.account.findFirstOrThrow({ where: { userId } })).id)
    expect(balances.cash.toString()).toBe('900') // only the original 100 was ever reserved
  })

  // ---- 6: different users, same key value -> fully independent ----

  it('6. different users using the identical Idempotency-Key value never share state', async () => {
    const a = await registerAndLogin('idemuserA')
    const b = await registerAndLogin('idemuserB')
    await grantBalance(a.userId, '500')
    await grantBalance(b.userId, '500')
    const sharedKey = 'shared-key-value-not-unique-per-user'

    const rA = await request(server).post('/withdrawals').set('Cookie', a.cookie).set('Idempotency-Key', sharedKey).send({ amount: '100', destination: 'wallet-A' }).expect(201)
    const rB = await request(server).post('/withdrawals').set('Cookie', b.cookie).set('Idempotency-Key', sharedKey).send({ amount: '200', destination: 'wallet-B' }).expect(201)

    expect(rA.body.id).not.toBe(rB.body.id)
    expect(await prisma.withdrawal.count({ where: { userId: a.userId } })).toBe(1)
    expect(await prisma.withdrawal.count({ where: { userId: b.userId } })).toBe(1)

    const balA = await ledger.getAccountBalances((await prisma.account.findFirstOrThrow({ where: { userId: a.userId } })).id)
    const balB = await ledger.getAccountBalances((await prisma.account.findFirstOrThrow({ where: { userId: b.userId } })).id)
    expect(balA.cash.toString()).toBe('400') // 500 - 100
    expect(balB.cash.toString()).toBe('300') // 500 - 200
  })

  // ---- 7: idempotency state survives a "backend restart" (a fresh app instance against the same DB) ----

  it('7. idempotency state is persisted in PostgreSQL, not process memory — a fresh app instance still replays correctly', async () => {
    const { userId, cookie } = await registerAndLogin('idemrestart')
    await grantBalance(userId, '500')
    const key = `wkey-restart-${Date.now()}`
    const body = { amount: '100', destination: 'wallet-restart' }

    const r1 = await request(server).post('/withdrawals').set('Cookie', cookie).set('Idempotency-Key', key).send(body).expect(201)

    // Simulate a backend restart: a brand-new NestJS application instance,
    // fresh in-memory state, connected to the SAME PostgreSQL database.
    const restarted = await createTestApp()
    try {
      const r2 = await request(restarted.app.getHttpServer())
        .post('/withdrawals')
        .set('Cookie', cookie)
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201)
      expect(r2.body.id).toBe(r1.body.id) // replayed from the DB, not re-executed
    } finally {
      await restarted.app.close()
    }

    const count = await prisma.withdrawal.count({ where: { userId } })
    expect(count).toBe(1)
  })

  // ---- 9 & 10: system ledger account race ----

  it('9. concurrent first-time initialization of the same system ledger account results in exactly one row', async () => {
    const currency = `TESTCUR${Date.now()}` // unique currency so this is genuinely this test's first-ever access
    const [a, b, c] = await Promise.all([
      ledger.getSystemLedgerAccount('FEES', currency),
      ledger.getSystemLedgerAccount('FEES', currency),
      ledger.getSystemLedgerAccount('FEES', currency),
    ])
    expect(a.id).toBe(b.id)
    expect(b.id).toBe(c.id)

    const rows = await prisma.ledgerAccount.findMany({ where: { ownerType: 'SYSTEM', type: 'FEES', currency } })
    expect(rows).toHaveLength(1)
  })

  it('10. concurrent initialization of different system-account types produces one valid account for each, independently', async () => {
    const currency = `TESTCUR2${Date.now()}`
    const [revenue, fees, suspense] = await Promise.all([
      ledger.getSystemLedgerAccount('REVENUE', currency),
      ledger.getSystemLedgerAccount('FEES', currency),
      ledger.getSystemLedgerAccount('SUSPENSE', currency),
    ])
    expect(new Set([revenue.id, fees.id, suspense.id]).size).toBe(3) // three distinct accounts, not merged/blocked by each other's lock

    for (const type of ['REVENUE', 'FEES', 'SUSPENSE'] as const) {
      const rows = await prisma.ledgerAccount.findMany({ where: { ownerType: 'SYSTEM', type, currency } })
      expect(rows).toHaveLength(1)
    }
  })

  it('11. on a fresh disposable database, system accounts initialize correctly on first real use', async () => {
    // This whole suite already runs against a freshly-migrated disposable
    // database (see test/setup-env.ts) — REVENUE was never touched before
    // this point in a currency unique to this test, proving first-use
    // initialization (not just re-use of a pre-existing row) works.
    const currency = `FRESHCUR${Date.now()}`
    const account = await ledger.getSystemLedgerAccount('REVENUE', currency)
    expect(account.ownerType).toBe('SYSTEM')
    expect(account.accountId).toBeNull()
    const balance = await ledger.getLedgerAccountBalance(account.id)
    expect(balance.toString()).toBe('0')
  })

  it('12. on an already-existing database, repeated calls return the same existing system account unchanged', async () => {
    const currency = `EXISTCUR${Date.now()}`
    const first = await ledger.getSystemLedgerAccount('SUSPENSE', currency)
    const second = await ledger.getSystemLedgerAccount('SUSPENSE', currency)
    const third = await ledger.getSystemLedgerAccount('SUSPENSE', currency)
    expect(first.id).toBe(second.id)
    expect(second.id).toBe(third.id)
    const rows = await prisma.ledgerAccount.findMany({ where: { ownerType: 'SYSTEM', type: 'SUSPENSE', currency } })
    expect(rows).toHaveLength(1)
  })

  // ---- 17: every ledger transaction created by this suite stays balanced ----

  it('17. every ledger transaction created by idempotent retries remains balanced (credits == debits per currency)', async () => {
    const { userId, cookie } = await registerAndLogin('idembalance')
    await grantBalance(userId, '500')
    const key = `wkey-balance-${Date.now()}`
    await Promise.all([
      request(server).post('/withdrawals').set('Cookie', cookie).set('Idempotency-Key', key).send({ amount: '100', destination: 'w' }),
      request(server).post('/withdrawals').set('Cookie', cookie).set('Idempotency-Key', key).send({ amount: '100', destination: 'w' }),
    ])

    const account = await prisma.account.findFirstOrThrow({ where: { userId } })
    const ledgerAccounts = await prisma.ledgerAccount.findMany({ where: { accountId: account.id } })
    const myEntries = await prisma.ledgerEntry.findMany({ where: { ledgerAccountId: { in: ledgerAccounts.map((a) => a.id) } } })

    // Two transactions exist for this account overall: the grantBalance()
    // test fixture's own ADJUSTMENT, and the withdrawal reservation.
    // Confirm exactly one WITHDRAWAL-type transaction touched this account
    // — not two, which a duplicate reservation would have produced.
    const withdrawalTransactionIds = [...new Set(myEntries.filter((e) => e.entryType === 'WITHDRAWAL').map((e) => e.transactionId))]
    expect(withdrawalTransactionIds).toHaveLength(1)

    // For every distinct transaction this account participated in, pull
    // ALL of its entries (both legs — including the SUSPENSE/REVENUE
    // counterparty on a different ledger account) and confirm
    // credits == debits per currency, re-deriving the same invariant
    // LedgerService.validateEntries() enforces at write time, from the
    // committed rows themselves rather than trusting the write path.
    const transactionIds = [...new Set(myEntries.map((e) => e.transactionId))]
    for (const transactionId of transactionIds) {
      const fullEntries = await prisma.ledgerEntry.findMany({ where: { transactionId } })
      const byCurrency = new Map<string, { credit: number; debit: number }>()
      for (const e of fullEntries) {
        const bucket = byCurrency.get(e.currency) ?? { credit: 0, debit: 0 }
        if (e.direction === 'CREDIT') bucket.credit += Number(e.amount)
        else bucket.debit += Number(e.amount)
        byCurrency.set(e.currency, bucket)
      }
      for (const { credit, debit } of byCurrency.values()) {
        expect(credit).toBe(debit)
      }
    }
  })
})
