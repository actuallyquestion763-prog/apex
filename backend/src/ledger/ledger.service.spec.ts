import { BadRequestException } from '@nestjs/common'
import { Decimal } from '@prisma/client/runtime/library'
import { LedgerService } from './ledger.service'
import { PrismaService } from '../prisma/prisma.service'

// Unit tests against a mocked PrismaService — no real database involved.
// These verify the ledger's core invariants: balance enforcement,
// idempotency, and correct balance derivation from entries.
describe('LedgerService', () => {
  let prisma: {
    ledgerTransaction: { findUnique: jest.Mock; create: jest.Mock }
    ledgerAccount: { findUnique: jest.Mock; findFirst: jest.Mock; create: jest.Mock }
    ledgerEntry: { aggregate: jest.Mock }
    $transaction: jest.Mock
  }
  let service: LedgerService

  beforeEach(() => {
    prisma = {
      ledgerTransaction: { findUnique: jest.fn(), create: jest.fn() },
      ledgerAccount: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
      ledgerEntry: { aggregate: jest.fn() },
      $transaction: jest.fn(),
    }
    service = new LedgerService(prisma as unknown as PrismaService)
  })

  it('rejects a transaction with fewer than two entries', async () => {
    await expect(
      service.postTransaction({
        description: 'bad',
        entries: [{ ledgerAccountId: 'a', direction: 'CREDIT', amount: 10, entryType: 'DEPOSIT' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('rejects an unbalanced transaction (credits != debits)', async () => {
    await expect(
      service.postTransaction({
        description: 'unbalanced deposit',
        entries: [
          { ledgerAccountId: 'suspense', direction: 'DEBIT', amount: 100, entryType: 'DEPOSIT' },
          { ledgerAccountId: 'cash', direction: 'CREDIT', amount: 99, entryType: 'DEPOSIT' },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('rejects a zero or negative entry amount', async () => {
    await expect(
      service.postTransaction({
        description: 'zero amount',
        entries: [
          { ledgerAccountId: 'suspense', direction: 'DEBIT', amount: 0, entryType: 'DEPOSIT' },
          { ledgerAccountId: 'cash', direction: 'CREDIT', amount: 0, entryType: 'DEPOSIT' },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('accepts a balanced transaction and posts it inside a single db transaction', async () => {
    const fakeTx = { id: 'tx-1', entries: [] }
    prisma.$transaction.mockImplementation(async (cb: any) => cb({
      ledgerTransaction: { create: jest.fn().mockResolvedValue(fakeTx) },
    }))

    const result = await service.postTransaction({
      description: 'deposit of 100',
      idempotencyKey: 'deposit-abc',
      entries: [
        { ledgerAccountId: 'suspense', direction: 'DEBIT', amount: 100, entryType: 'DEPOSIT' },
        { ledgerAccountId: 'cash', direction: 'CREDIT', amount: 100, entryType: 'DEPOSIT' },
      ],
    })

    expect(prisma.ledgerTransaction.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { idempotencyKey: 'deposit-abc' } }),
    )
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(result).toEqual(fakeTx)
  })

  it('is idempotent: a repeated idempotencyKey returns the existing transaction without posting again', async () => {
    const existing = { id: 'tx-existing', entries: [] }
    prisma.ledgerTransaction.findUnique.mockResolvedValue(existing)

    const result = await service.postTransaction({
      description: 'duplicate webhook delivery',
      idempotencyKey: 'deposit-abc',
      entries: [
        { ledgerAccountId: 'suspense', direction: 'DEBIT', amount: 100, entryType: 'DEPOSIT' },
        { ledgerAccountId: 'cash', direction: 'CREDIT', amount: 100, entryType: 'DEPOSIT' },
      ],
    })

    expect(result).toEqual(existing)
    expect(prisma.$transaction).not.toHaveBeenCalled() // no new entries posted
  })

  it('derives balance as sum(credits) - sum(debits)', async () => {
    prisma.ledgerEntry.aggregate
      .mockResolvedValueOnce({ _sum: { amount: new Decimal(250) } }) // credits
      .mockResolvedValueOnce({ _sum: { amount: new Decimal(75) } }) // debits

    const balance = await service.getLedgerAccountBalance('acct-1')
    expect(balance.toString()).toBe('175')
  })

  it('derives a zero balance from an account with no entries yet', async () => {
    prisma.ledgerEntry.aggregate
      .mockResolvedValueOnce({ _sum: { amount: null } })
      .mockResolvedValueOnce({ _sum: { amount: null } })

    const balance = await service.getLedgerAccountBalance('fresh-account')
    expect(balance.toString()).toBe('0')
  })
})
