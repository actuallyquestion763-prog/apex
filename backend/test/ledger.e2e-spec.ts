import type { INestApplication } from '@nestjs/common'
import { createTestApp } from './helpers/test-app'
import { LedgerService } from '../src/ledger/ledger.service'
import { PrismaService } from '../src/prisma/prisma.service'

describe('LedgerService against real PostgreSQL', () => {
  let app: INestApplication
  let ledger: LedgerService
  let prisma: PrismaService

  beforeAll(async () => {
    const t = await createTestApp()
    app = t.app
    prisma = t.prisma
    ledger = app.get(LedgerService)
  })

  afterAll(async () => {
    await app.close()
  })

  async function freshAccountId() {
    const user = await prisma.user.create({
      data: { email: `ledger-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`, passwordHash: 'x', fullName: 'Ledger Test' },
    })
    const account = await prisma.account.create({ data: { userId: user.id } })
    return account.id
  }

  it('a fresh account has a zero balance derived from zero rows', async () => {
    const accountId = await freshAccountId()
    const balances = await ledger.getAccountBalances(accountId)
    expect(balances.cash.toString()).toBe('0')
    expect(balances.reserved.toString()).toBe('0')
  })

  it('posting a real deposit transaction increases cash by exactly the amount', async () => {
    const accountId = await freshAccountId()
    const { cash } = await ledger.getOrCreateUserLedgerAccounts(accountId)
    const suspense = await ledger.getSystemLedgerAccount('SUSPENSE')

    await ledger.postTransaction({
      description: 'test deposit',
      entries: [
        { ledgerAccountId: suspense.id, direction: 'DEBIT', amount: '500.12345678', entryType: 'DEPOSIT' },
        { ledgerAccountId: cash.id, direction: 'CREDIT', amount: '500.12345678', entryType: 'DEPOSIT' },
      ],
    })

    const balances = await ledger.getAccountBalances(accountId)
    expect(balances.cash.toString()).toBe('500.12345678') // Decimal precision preserved, not float-rounded
  })

  it('rejects an unbalanced transaction — nothing is written to the real database', async () => {
    const accountId = await freshAccountId()
    const { cash } = await ledger.getOrCreateUserLedgerAccounts(accountId)
    const suspense = await ledger.getSystemLedgerAccount('SUSPENSE')

    await expect(
      ledger.postTransaction({
        description: 'unbalanced',
        entries: [
          { ledgerAccountId: suspense.id, direction: 'DEBIT', amount: '100', entryType: 'DEPOSIT' },
          { ledgerAccountId: cash.id, direction: 'CREDIT', amount: '99', entryType: 'DEPOSIT' },
        ],
      }),
    ).rejects.toThrow()

    const count = await prisma.ledgerEntry.count({ where: { ledgerAccountId: cash.id } })
    expect(count).toBe(0) // confirmed against the real table, not just "the call threw"
  })

  it('idempotency: the same key posted twice against the real database results in exactly one set of entries', async () => {
    const accountId = await freshAccountId()
    const { cash } = await ledger.getOrCreateUserLedgerAccounts(accountId)
    const suspense = await ledger.getSystemLedgerAccount('SUSPENSE')
    const key = `idem-test-${Date.now()}`

    const input = {
      description: 'idempotent deposit',
      idempotencyKey: key,
      entries: [
        { ledgerAccountId: suspense.id, direction: 'DEBIT' as const, amount: '250', entryType: 'DEPOSIT' as const },
        { ledgerAccountId: cash.id, direction: 'CREDIT' as const, amount: '250', entryType: 'DEPOSIT' as const },
      ],
    }

    const first = await ledger.postTransaction(input)
    const second = await ledger.postTransaction(input)
    expect(second.id).toBe(first.id)

    const txCount = await prisma.ledgerTransaction.count({ where: { idempotencyKey: key } })
    expect(txCount).toBe(1)
    const balance = await ledger.getLedgerAccountBalance(cash.id)
    expect(balance.toString()).toBe('250') // not 500 — the second call did not post again
  })

  it('concurrent postTransaction calls with the same idempotency key still result in exactly one transaction (real DB unique constraint)', async () => {
    const accountId = await freshAccountId()
    const { cash } = await ledger.getOrCreateUserLedgerAccounts(accountId)
    const suspense = await ledger.getSystemLedgerAccount('SUSPENSE')
    const key = `idem-race-${Date.now()}`

    const input = {
      description: 'concurrent idempotent deposit',
      idempotencyKey: key,
      entries: [
        { ledgerAccountId: suspense.id, direction: 'DEBIT' as const, amount: '10', entryType: 'DEPOSIT' as const },
        { ledgerAccountId: cash.id, direction: 'CREDIT' as const, amount: '10', entryType: 'DEPOSIT' as const },
      ],
    }

    // Fire both at once — this is what actually exercises the P2002 race
    // path, not just the fast idempotency-key pre-check.
    const [a, b] = await Promise.all([ledger.postTransaction(input), ledger.postTransaction(input)])
    expect(a.id).toBe(b.id)

    const txCount = await prisma.ledgerTransaction.count({ where: { idempotencyKey: key } })
    expect(txCount).toBe(1)
    const balance = await ledger.getLedgerAccountBalance(cash.id)
    expect(balance.toString()).toBe('10')
  })
})
