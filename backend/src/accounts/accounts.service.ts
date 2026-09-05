import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Decimal } from '@prisma/client/runtime/library'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService } from '../ledger/ledger.service'
import { MarketDataService } from '../markets/market-data.service'
import { CONVERT_SYMBOL } from './convert-currencies'
import type { ConvertDto } from './dto/convert.dto'

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
    private readonly marketData: MarketDataService,
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
    // equity/cash/total here are USD-denominated (see getCashBalance's
    // comment above) — only fold in P&L from USD-quoted positions. Most
    // crypto markets are USDT-quoted; that P&L is a USDT amount and must
    // never be added to a USD total as if the same unit.
    const usdSymbols = new Set(
      (await this.prisma.marketConfig.findMany({ where: { quoteAsset: 'USD' }, select: { symbol: true } })).map((m) => m.symbol),
    )
    const unrealizedPnl = openPositions
      .filter((p) => usdSymbols.has(p.symbol))
      .reduce((sum, p) => sum.plus(unrealizedPnlFor(p)), new Decimal(0))

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

  // ===========================================================================
  // Currency conversion (Part 32) — exchanges one currency the user holds
  // for another, at a rate derived entirely from real MarketDataService
  // quotes (never a hardcoded or client-supplied rate). LedgerService's
  // validateEntries() requires credits==debits WITHIN EACH currency (real
  // double-entry bookkeeping) — a single entry pair can never move value
  // across two different currencies. So this posts TWO separately-balanced
  // legs atomically in one advisory-locked transaction: DEBIT the user's
  // source cash / CREDIT a system REVENUE account (same currency, same
  // amount — balanced), then DEBIT that system REVENUE account in the
  // destination currency / CREDIT the user's destination cash (balanced).
  // Same system-account pattern AdminService.createFinancialAdjustment
  // already uses for a currency-neutral value move — no value is created or
  // destroyed here, only exchanged.
  //
  // Exactly-once-per-idempotency-key is guaranteed by the CALLER
  // (AccountsController wraps this whole method in IdempotencyService.run(),
  // which never re-invokes it for a repeated key) — this method itself
  // takes no idempotency key, since a single client key would collide
  // across the two separate LedgerTransaction rows below.
  // ===========================================================================

  private async priceInUsdt(currency: string): Promise<Decimal> {
    if (currency === 'USDT') return new Decimal(1)
    const symbol = CONVERT_SYMBOL[currency]
    if (!(currency in CONVERT_SYMBOL) || !symbol) throw new BadRequestException(`"${currency}" is not a supported conversion currency.`)
    const quote = await this.marketData.getQuote(symbol)
    if (quote.status !== 'LIVE' && quote.status !== 'SIMULATED') {
      throw new BadRequestException(`Market price for ${symbol} is not currently available (${quote.status}). Try again shortly.`)
    }
    return new Decimal(quote.last)
  }

  async convert(userId: string, dto: ConvertDto) {
    if (dto.fromCurrency === dto.toCurrency) {
      throw new BadRequestException('Choose two different currencies to convert between.')
    }
    const amount = new Decimal(dto.amount)
    if (!amount.isFinite() || amount.lte(0)) {
      throw new BadRequestException('Amount must be a positive number.')
    }

    const account = await this.getPrimaryAccount(userId)

    // Prices read before the lock — display/rate math only. The
    // authoritative balance check happens inside the locked section below,
    // exactly like every other financial-creation path in this codebase.
    const [fromPrice, toPrice] = await Promise.all([this.priceInUsdt(dto.fromCurrency), this.priceInUsdt(dto.toCurrency)])
    // Rounded to the ledger column's own precision (Decimal(20,8)) so the
    // amount reported back to the caller is byte-for-byte what actually
    // gets persisted — never a higher-precision phantom value the database
    // silently truncates after the fact.
    const toAmount = amount.times(fromPrice).dividedBy(toPrice).toDecimalPlaces(8)

    const { cash: fromCash } = await this.ledger.getOrCreateUserLedgerAccounts(account.id, dto.fromCurrency)
    const { cash: toCash } = await this.ledger.getOrCreateUserLedgerAccounts(account.id, dto.toCurrency)
    const fromSystem = await this.ledger.getSystemLedgerAccount('REVENUE', dto.fromCurrency)
    const toSystem = await this.ledger.getSystemLedgerAccount('REVENUE', dto.toCurrency)

    const description = `Converted ${amount.toString()} ${dto.fromCurrency} to ${dto.toCurrency}`
    const transactionId = await this.prisma.$transaction(async (tx) => {
      // Only the SOURCE account can ever go invalid (negative) from this
      // operation — the destination is only ever credited, which can never
      // fail a balance check, so only fromCash needs the advisory lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${fromCash.id}))`
      const balance = await this.ledger.getLedgerAccountBalanceLocked(tx, fromCash.id)
      if (balance.lt(amount)) throw new BadRequestException('Insufficient balance for this conversion.')

      const outLeg = await this.ledger.insertTransactionInLock(tx, {
        description,
        relatedType: 'CONVERSION',
        relatedId: account.id,
        entries: [
          { ledgerAccountId: fromCash.id, direction: 'DEBIT', amount, currency: dto.fromCurrency, entryType: 'CONVERSION' },
          { ledgerAccountId: fromSystem.id, direction: 'CREDIT', amount, currency: dto.fromCurrency, entryType: 'CONVERSION' },
        ],
      })
      await this.ledger.insertTransactionInLock(tx, {
        description,
        relatedType: 'CONVERSION',
        relatedId: account.id,
        entries: [
          { ledgerAccountId: toSystem.id, direction: 'DEBIT', amount: toAmount, currency: dto.toCurrency, entryType: 'CONVERSION' },
          { ledgerAccountId: toCash.id, direction: 'CREDIT', amount: toAmount, currency: dto.toCurrency, entryType: 'CONVERSION' },
        ],
      })
      return outLeg.id
    })

    return {
      transactionId,
      fromCurrency: dto.fromCurrency,
      toCurrency: dto.toCurrency,
      fromAmount: amount.toString(),
      toAmount: toAmount.toString(),
    }
  }
}
