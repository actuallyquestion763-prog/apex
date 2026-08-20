import { Injectable, NotFoundException } from '@nestjs/common'
import { Decimal } from '@prisma/client/runtime/library'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService } from '../ledger/ledger.service'

// Unrealized P&L for one open position: (current - entry) * qty for BUY,
// (entry - current) * qty for SELL. Matches the existing frontend's
// computePnL semantics (src/store/useStore.ts) — not a new formula.
// If currentPrice hasn't been marked yet, the position contributes 0.
function unrealizedPnlFor(position: { side: string; quantity: Decimal; avgEntryPrice: Decimal; currentPrice: Decimal | null }): Decimal {
  if (!position.currentPrice) return new Decimal(0)
  const diff = position.side === 'BUY'
    ? position.currentPrice.minus(position.avgEntryPrice)
    : position.avgEntryPrice.minus(position.currentPrice)
  return diff.times(position.quantity)
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  async getPrimaryAccount(userId: string) {
    const account = await this.prisma.account.findFirst({ where: { userId } })
    if (!account) throw new NotFoundException('No trading account found for this user.')
    return account
  }

  // Total / Available / Reserved / Equity — all derived, never stored.
  // Equity additionally folds in unrealized P&L from open positions, which
  // lives in the Position table (updated by mark-to-market, not the ledger —
  // unrealized P&L is not "real" money movement until a position closes).
  async getFinancialSummary(userId: string) {
    const account = await this.getPrimaryAccount(userId)
    const balances = await this.ledger.getAccountBalances(account.id)
    const openPositions = await this.prisma.position.findMany({
      where: { accountId: account.id, status: 'OPEN' },
    })
    const unrealizedPnl = openPositions.reduce(
      (sum, p) => sum.plus(unrealizedPnlFor(p)),
      new Decimal(0),
    )

    return {
      accountId: account.id,
      cash: balances.cash.toString(),
      reserved: balances.reserved.toString(),
      total: balances.total.toString(),
      unrealizedPnl: unrealizedPnl.toString(),
      equity: balances.total.plus(unrealizedPnl).toString(),
      openPositionCount: openPositions.length,
    }
  }

  // Currency-specific cash balance (Trade Experience checkpoint, Part 1) —
  // deliberately NOT folded into getFinancialSummary() above: that method's
  // existing USD-only shape is depended on by Profile/Dashboard/Wallet
  // already, and equity/unrealizedPnl there are USD-denominated concepts
  // that don't generalize cleanly to "equity in an arbitrary currency". A
  // market's quote/spend asset (e.g. USDT for BTC/USDT) is a completely
  // independent LedgerAccount from the USD one — see ledger.service.ts's
  // per-(account,currency) uniqueness — so the Trade page needs its own
  // lightweight, explicitly-currency-scoped read.
  async getCashBalance(userId: string, currency: string) {
    const account = await this.getPrimaryAccount(userId)
    const balances = await this.ledger.getAccountBalances(account.id, currency)
    return {
      accountId: account.id,
      currency,
      cash: balances.cash.toString(),
      reserved: balances.reserved.toString(),
    }
  }

  // Spot Holdings Visibility checkpoint — every currency the user has ever
  // touched, with a non-zero CASH+RESERVED balance. Deliberately reads only
  // LedgerAccount rows that ALREADY EXIST (`findMany`, never
  // getOrCreateUserLedgerAccounts) and aggregates existing LedgerEntry rows
  // — this method cannot create a LedgerAccount, LedgerEntry, or
  // LedgerTransaction under any circumstance, matching this checkpoint's
  // "display/read-only from a financial perspective" requirement. No price,
  // no unrealized P&L, no Position read — the ledger balance IS the figure.
  async listNonZeroAssetBalances(userId: string) {
    const account = await this.getPrimaryAccount(userId)
    const ledgerAccounts = await this.prisma.ledgerAccount.findMany({
      where: { accountId: account.id, type: { in: ['CASH', 'RESERVED'] } },
    })

    const byCurrency = new Map<string, { cashId?: string; reservedId?: string }>()
    for (const la of ledgerAccounts) {
      const entry = byCurrency.get(la.currency) ?? {}
      if (la.type === 'CASH') entry.cashId = la.id
      else entry.reservedId = la.id
      byCurrency.set(la.currency, entry)
    }

    const results: { currency: string; cash: string; reserved: string; total: string }[] = []
    for (const [currency, ids] of byCurrency) {
      const cash = ids.cashId ? await this.ledger.getLedgerAccountBalance(ids.cashId) : new Decimal(0)
      const reserved = ids.reservedId ? await this.ledger.getLedgerAccountBalance(ids.reservedId) : new Decimal(0)
      const total = cash.plus(reserved)
      if (!total.isZero()) {
        results.push({ currency, cash: cash.toString(), reserved: reserved.toString(), total: total.toString() })
      }
    }

    return results.sort((a, b) => a.currency.localeCompare(b.currency))
  }

  // Read-only transaction history for the authenticated user's own account —
  // every LedgerEntry across their CASH/RESERVED ledger accounts, newest
  // first. The frontend displays this as-is; it does not recompute or
  // re-derive anything from it.
  async getLedgerHistory(userId: string, limit = 100) {
    const account = await this.getPrimaryAccount(userId)
    const ledgerAccounts = await this.prisma.ledgerAccount.findMany({ where: { accountId: account.id } })
    const ledgerAccountIds = ledgerAccounts.map((a) => a.id)
    const ledgerAccountTypeById = new Map(ledgerAccounts.map((a) => [a.id, a.type]))

    const entries = await this.prisma.ledgerEntry.findMany({
      where: { ledgerAccountId: { in: ledgerAccountIds } },
      include: { transaction: true },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
    })

    return entries.map((e) => ({
      id: e.id,
      ledgerAccount: ledgerAccountTypeById.get(e.ledgerAccountId),
      direction: e.direction,
      amount: e.amount.toString(),
      currency: e.currency,
      entryType: e.entryType,
      description: e.transaction.description,
      relatedType: e.transaction.relatedType,
      relatedId: e.transaction.relatedId,
      createdAt: e.createdAt,
    }))
  }
}
