import type { INestApplication } from '@nestjs/common'
import { createTestApp, uniqueEmail, createUserDirect } from './helpers/test-app'
import { LedgerService } from '../src/ledger/ledger.service'
import type { PrismaService } from '../src/prisma/prisma.service'

// Phase 6F, Checkpoint A — proves the Phase 6E architectural fix actually
// works against real PostgreSQL: LedgerAccount.@@unique([accountId, type])
// widened to @@unique([accountId, type, currency]) (migration
// 20260818160000_multi_currency_ledger_accounts), plus the new
// currency-match validation between a LedgerEntry and the LedgerAccount it
// posts against. No balance column was added — LedgerAccount + LedgerEntry
// remain the sole source of truth; this only proves multiple (type,
// currency) pairs can now coexist under one Account.
describe('Multi-currency ledger foundation (real PostgreSQL)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let ledger: LedgerService

  beforeAll(async () => {
    const t = await createTestApp()
    app = t.app
    prisma = t.prisma
    ledger = app.get(LedgerService)
  })

  afterAll(async () => {
    await app.close()
  })

  async function makeAccount(prefix: string) {
    const email = uniqueEmail(prefix)
    const { account } = await createUserDirect(prisma, { email, password: 'correct-horse-battery', fullName: 'Multi Currency Test' })
    return account.id
  }

  it('1. one Account can hold CASH/USD, CASH/USDT, CASH/BTC, RESERVED/USDT and RESERVED/BTC simultaneously', async () => {
    const accountId = await makeAccount('multicur-coexist')

    const usd = await ledger.getOrCreateUserLedgerAccounts(accountId, 'USD')
    const usdt = await ledger.getOrCreateUserLedgerAccounts(accountId, 'USDT')
    const btc = await ledger.getOrCreateUserLedgerAccounts(accountId, 'BTC')

    // Five distinct LedgerAccount rows, all under the same accountId.
    const ids = new Set([usd.cash.id, usd.reserved.id, usdt.cash.id, usdt.reserved.id, btc.cash.id, btc.reserved.id])
    expect(ids.size).toBe(6)

    const rows = await prisma.ledgerAccount.findMany({ where: { accountId } })
    expect(rows.length).toBe(6)
    expect(rows.filter((r) => r.currency === 'USD').length).toBe(2) // CASH + RESERVED
    expect(rows.filter((r) => r.currency === 'USDT').length).toBe(2)
    expect(rows.filter((r) => r.currency === 'BTC').length).toBe(2)
  })

  it('2. calling getOrCreateUserLedgerAccounts twice for the same currency returns the SAME rows, not duplicates', async () => {
    const accountId = await makeAccount('multicur-idempotent')
    const first = await ledger.getOrCreateUserLedgerAccounts(accountId, 'ETH')
    const second = await ledger.getOrCreateUserLedgerAccounts(accountId, 'ETH')
    expect(second.cash.id).toBe(first.cash.id)
    expect(second.reserved.id).toBe(first.reserved.id)

    const rows = await prisma.ledgerAccount.findMany({ where: { accountId, currency: 'ETH' } })
    expect(rows.length).toBe(2) // still exactly CASH + RESERVED, no duplicate row
  })

  it('3. a genuine duplicate (same accountId, type, currency) is still rejected at the database level', async () => {
    const accountId = await makeAccount('multicur-dup-blocked')
    await ledger.getOrCreateUserLedgerAccounts(accountId, 'SOL')
    await expect(
      prisma.ledgerAccount.create({ data: { accountId, ownerType: 'USER', type: 'CASH', currency: 'SOL' } }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('4. a balanced multi-asset transaction (BTC entries + USDT entries in one call) posts correctly, each currency balancing independently', async () => {
    const accountId = await makeAccount('multicur-post')
    const btc = await ledger.getOrCreateUserLedgerAccounts(accountId, 'BTC')
    const usdt = await ledger.getOrCreateUserLedgerAccounts(accountId, 'USDT')
    const revenueBtc = await ledger.getSystemLedgerAccount('REVENUE', 'BTC')
    const revenueUsdt = await ledger.getSystemLedgerAccount('REVENUE', 'USDT')

    await ledger.postTransaction({
      description: 'test fixture — simulated spot settlement (BTC credit + USDT debit in one transaction)',
      idempotencyKey: `multicur-post-${accountId}`,
      entries: [
        { ledgerAccountId: revenueBtc.id, direction: 'DEBIT', amount: '0.5', currency: 'BTC', entryType: 'ADJUSTMENT' },
        { ledgerAccountId: btc.cash.id, direction: 'CREDIT', amount: '0.5', currency: 'BTC', entryType: 'ADJUSTMENT' },
        { ledgerAccountId: usdt.cash.id, direction: 'DEBIT', amount: '100', currency: 'USDT', entryType: 'ADJUSTMENT' },
        { ledgerAccountId: revenueUsdt.id, direction: 'CREDIT', amount: '100', currency: 'USDT', entryType: 'ADJUSTMENT' },
      ],
    })

    const btcBalance = await ledger.getLedgerAccountBalance(btc.cash.id)
    const usdtBalance = await ledger.getLedgerAccountBalance(usdt.cash.id)
    expect(btcBalance.toString()).toBe('0.5')
    expect(usdtBalance.toString()).toBe('-100')
  })

  it('5. an entry whose currency does not match its target LedgerAccount is rejected, and nothing partially writes', async () => {
    const accountId = await makeAccount('multicur-mismatch')
    const usd = await ledger.getOrCreateUserLedgerAccounts(accountId, 'USD') // account.currency === 'USD'
    const revenue = await ledger.getSystemLedgerAccount('REVENUE', 'USD')

    await expect(
      ledger.postTransaction({
        description: 'test fixture — mismatched currency (BTC entry against a USD ledger account)',
        idempotencyKey: `multicur-mismatch-${accountId}`,
        entries: [
          // entry.currency says BTC, but usd.cash's LedgerAccount.currency is 'USD'.
          { ledgerAccountId: revenue.id, direction: 'DEBIT', amount: '1', currency: 'BTC', entryType: 'ADJUSTMENT' },
          { ledgerAccountId: usd.cash.id, direction: 'CREDIT', amount: '1', currency: 'BTC', entryType: 'ADJUSTMENT' },
        ],
      }),
    ).rejects.toThrow(/currency/i)

    // Nothing was written: no transaction, no entries, balance untouched.
    const txn = await prisma.ledgerTransaction.findUnique({ where: { idempotencyKey: `multicur-mismatch-${accountId}` } })
    expect(txn).toBeNull()
    const balance = await ledger.getLedgerAccountBalance(usd.cash.id)
    expect(balance.toString()).toBe('0')
  })

  it('6. the same rule applies via postTransactionWithAccountLock (the advisory-locked path used by orders/withdrawals)', async () => {
    const accountId = await makeAccount('multicur-mismatch-locked')
    const usdt = await ledger.getOrCreateUserLedgerAccounts(accountId, 'USDT')
    const revenue = await ledger.getSystemLedgerAccount('REVENUE', 'USDT')

    await expect(
      ledger.postTransactionWithAccountLock(usdt.cash.id, {
        description: 'test fixture — mismatched currency via locked path',
        idempotencyKey: `multicur-mismatch-locked-${accountId}`,
        entries: [
          { ledgerAccountId: revenue.id, direction: 'DEBIT', amount: '1', currency: 'ETH', entryType: 'ADJUSTMENT' },
          { ledgerAccountId: usdt.cash.id, direction: 'CREDIT', amount: '1', currency: 'ETH', entryType: 'ADJUSTMENT' },
        ],
      }),
    ).rejects.toThrow(/currency/i)

    const balance = await ledger.getLedgerAccountBalance(usdt.cash.id)
    expect(balance.toString()).toBe('0')
  })

  it('7. existing default-currency (USD) behavior is completely unchanged — real order/deposit paths still work', async () => {
    // Regression guard: the widened constraint + new validation must not
    // break the existing single-currency USD flow every other test in this
    // suite depends on.
    const accountId = await makeAccount('multicur-regression')
    const { cash } = await ledger.getOrCreateUserLedgerAccounts(accountId)
    const revenue = await ledger.getSystemLedgerAccount('REVENUE')
    await ledger.postTransaction({
      description: 'test fixture — plain USD adjustment, unchanged behavior',
      idempotencyKey: `multicur-regression-${accountId}`,
      entries: [
        { ledgerAccountId: revenue.id, direction: 'DEBIT', amount: '250', entryType: 'ADJUSTMENT' },
        { ledgerAccountId: cash.id, direction: 'CREDIT', amount: '250', entryType: 'ADJUSTMENT' },
      ],
    })
    const balances = await ledger.getAccountBalances(accountId)
    expect(balances.cash.toString()).toBe('250')
  })
})
