import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { createTestApp, uniqueEmail, extractSessionCookie, createUserDirect, grantPermissionDirect } from './helpers/test-app'
import { LedgerService } from '../src/ledger/ledger.service'
import type { PrismaService } from '../src/prisma/prisma.service'

// Reconciliation foundation (Phase 5, Part 8/31 items 3-4). The app's own
// write path (LedgerService.postTransaction) already refuses to create an
// unbalanced transaction — so to prove reconciliation actually CATCHES one,
// these tests bypass that service entirely and write directly via Prisma,
// exactly the kind of "how would we ever notice" scenario reconciliation
// exists for.
describe('Financial Reconciliation (real PostgreSQL)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let ledger: LedgerService
  let server: any

  beforeAll(async () => {
    const t = await createTestApp()
    app = t.app
    prisma = t.prisma
    ledger = app.get(LedgerService)
    server = app.getHttpServer()
  })

  afterAll(async () => {
    await app.close()
  })

  async function loginAs(email: string, password: string) {
    const res = await request(server).post('/auth/login').send({ email, password }).expect(200)
    return extractSessionCookie(res)
  }

  async function makeReconciliationAdmin() {
    const email = uniqueEmail('reconadmin')
    const password = 'correct-horse-battery'
    const { user } = await createUserDirect(prisma, { email, password, role: 'ADMIN' })
    await grantPermissionDirect(prisma, user.id, 'ledger.read')
    const cookie = await loginAs(email, password)
    return { userId: user.id, cookie }
  }

  it('a plain USER cannot run reconciliation, and an admin without ledger.read gets 403', async () => {
    const email = uniqueEmail('reconuser')
    await createUserDirect(prisma, { email, password: 'correct-horse-battery', role: 'USER' })
    const userCookie = await loginAs(email, 'correct-horse-battery')
    await request(server).get('/admin/reconciliation').set('Cookie', userCookie).expect(403)

    const { user: bareAdmin } = await createUserDirect(prisma, { email: uniqueEmail('reconbareadmin'), password: 'correct-horse-battery', role: 'ADMIN' })
    const bareCookie = await loginAs(bareAdmin.email, 'correct-horse-battery')
    await request(server).get('/admin/reconciliation').set('Cookie', bareCookie).expect(403)
  })

  it('3. detects an intentionally created synthetic unbalanced transaction', async () => {
    const admin = await makeReconciliationAdmin()

    // Scoped to THIS test's own transaction id, not "no issues at all" —
    // this suite (and any earlier manual run of this same file, e.g.
    // during development) may share the disposable test database across
    // runs, so other synthetic fixtures can legitimately already exist.
    // Bypasses LedgerService entirely — raw Prisma write of a transaction
    // whose entries do NOT balance (100 credit, only 40 debit). This is
    // exactly what LedgerService.postTransaction()'s validateEntries()
    // exists to prevent on the real write path; here we're proving the
    // reconciliation *detection* path independently of that prevention.
    const revenue = await ledger.getSystemLedgerAccount('REVENUE')
    const fees = await ledger.getSystemLedgerAccount('FEES')
    const badTx = await prisma.ledgerTransaction.create({
      data: {
        description: 'SYNTHETIC TEST FIXTURE — intentionally unbalanced, never created by the app itself',
        entries: {
          create: [
            { ledgerAccountId: revenue.id, direction: 'CREDIT', amount: '100', entryType: 'ADJUSTMENT' },
            { ledgerAccountId: fees.id, direction: 'DEBIT', amount: '40', entryType: 'ADJUSTMENT' },
          ],
        },
      },
    })

    const after = await request(server).get('/admin/reconciliation').set('Cookie', admin.cookie).expect(200)
    expect(after.body.ok).toBe(false)
    const found = after.body.issues.find((i: any) => i.check === 'unbalanced_transaction' && i.details.transactionId === badTx.id)
    expect(found).toBeDefined()
    expect(found.severity).toBe('CRITICAL')
    expect(found.details.credits).toBe('100')
    expect(found.details.debits).toBe('40')
  })

  it('4. reconciliation is strictly read-only — running it never changes any row', async () => {
    const admin = await makeReconciliationAdmin()

    const countsBefore = await Promise.all([
      prisma.ledgerTransaction.count(),
      prisma.ledgerEntry.count(),
      prisma.ledgerAccount.count(),
      prisma.deposit.count(),
      prisma.withdrawal.count(),
    ])

    // Run it twice — if it wrote anything, running it again would either
    // change counts further or the two reports would disagree.
    const first = await request(server).get('/admin/reconciliation').set('Cookie', admin.cookie).expect(200)
    const second = await request(server).get('/admin/reconciliation').set('Cookie', admin.cookie).expect(200)

    const countsAfter = await Promise.all([
      prisma.ledgerTransaction.count(),
      prisma.ledgerEntry.count(),
      prisma.ledgerAccount.count(),
      prisma.deposit.count(),
      prisma.withdrawal.count(),
    ])

    expect(countsAfter).toEqual(countsBefore)
    expect(second.body.issueCount).toBe(first.body.issueCount)
  })

  it('detects a negative balance on a synthetic account without ever crediting money to "fix" it', async () => {
    const admin = await makeReconciliationAdmin()
    const customer = await createUserDirect(prisma, { email: uniqueEmail('reconneg'), password: 'correct-horse-battery', role: 'USER' })
    const { cash } = await ledger.getOrCreateUserLedgerAccounts(customer.account.id)
    const revenue = await ledger.getSystemLedgerAccount('REVENUE')

    // A balanced transaction (100 credit / 100 debit overall) that still
    // leaves one specific account (CASH, which started at 0) negative —
    // exactly the shape a bypassed concurrency check could theoretically
    // produce. postTransaction() only checks the transaction balances
    // overall, not that any single account stays non-negative; that
    // property is a business invariant, not a bookkeeping one, so it's
    // reconciliation's job to catch it, not LedgerService's.
    await ledger.postTransaction({
      description: 'SYNTHETIC TEST FIXTURE — deliberately drives CASH negative',
      idempotencyKey: `synthetic-negative-${customer.user.id}`,
      entries: [
        { ledgerAccountId: cash.id, direction: 'DEBIT', amount: '50', entryType: 'ADJUSTMENT' },
        { ledgerAccountId: revenue.id, direction: 'CREDIT', amount: '50', entryType: 'ADJUSTMENT' },
      ],
    })

    const report = await request(server).get('/admin/reconciliation').set('Cookie', admin.cookie).expect(200)
    const found = report.body.issues.find((i: any) => i.check === 'negative_balance' && i.details.ledgerAccountId === cash.id)
    expect(found).toBeDefined()
    expect(found.details.balance).toBe('-50')

    // Confirm reconciliation itself did not touch the balance — still -50,
    // not "fixed" back to 0.
    const stillNegative = await ledger.getLedgerAccountBalance(cash.id)
    expect(stillNegative.toString()).toBe('-50')
  })
})
