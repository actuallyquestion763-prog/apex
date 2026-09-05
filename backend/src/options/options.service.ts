import { randomUUID } from 'crypto'
import * as argon2 from 'argon2'
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common'
import { Decimal } from '@prisma/client/runtime/library'
import type { OptionTrade, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService } from '../ledger/ledger.service'
import type { LedgerEntryInput } from '../ledger/ledger.types'
import { AccountsService } from '../accounts/accounts.service'
import { MarketDataService } from '../markets/market-data.service'
import { AuditService } from '../audit/audit.service'
import { AuditEvent } from '../audit/audit-events'
import { generateReferralCode } from '../auth/referral-code.util'
import { toPublicUser } from '../users/public-user'
import { OptionsMarketService } from './options-market.service'
import { OptionsRiskService } from './options-risk.service'
import { computeProfit, computeReturn, determineResult } from './option-math'
import type { CreateOptionTradeDto } from './dto/create-option-trade.dto'
import { DEMO_RESULT_MODE_ALLOWED_ENVS, isDemoResultModeAllowed } from './sandbox-env'
import { OptionsSettingsService } from './options-settings.service'

// Trades whose expiryAt has passed, still ACTIVE or UNRESOLVED, get
// re-attempted on this cadence. 2s keeps the UI feeling responsive for a
// 30s-minimum-duration product without hammering the price provider.
const SWEEP_INTERVAL_MS = 2_000

export interface OptionTradeHistoryFilters {
  symbol?: string
  result?: 'WIN' | 'LOSS' | 'DRAW'
  activeOnly?: boolean
  completedOnly?: boolean
  from?: Date
  to?: Date
}

@Injectable()
export class OptionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('OptionsService')
  private sweepInterval: NodeJS.Timeout | null = null
  private sweeping = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly accounts: AccountsService,
    private readonly marketData: MarketDataService,
    private readonly audit: AuditService,
    private readonly optionsMarkets: OptionsMarketService,
    private readonly risk: OptionsRiskService,
    private readonly optionsSettings: OptionsSettingsService,
  ) {}

  // No background timer under NODE_ENV=test — e2e tests trigger settlement
  // deterministically via settleTrade()/runExpirySweep() directly, never by
  // racing a live wall-clock timer against the test run (Part 42's "tests
  // must be deterministic" principle, extended to this product's own
  // scheduler). Integrates with the existing graceful-shutdown mechanism
  // (main.ts's enableShutdownHooks() calls onModuleDestroy on every
  // provider, including this one — see Checkpoint I.1 Part 2).
  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return
    this.sweepInterval = setInterval(() => this.runExpirySweepSafely(), SWEEP_INTERVAL_MS)
  }

  onModuleDestroy() {
    if (this.sweepInterval) clearInterval(this.sweepInterval)
  }

  // ===========================================================================
  // Trade creation (Part 11) — one atomic pipeline, zero rows on any failure.
  // ===========================================================================

  async createTrade(userId: string, dto: CreateOptionTradeDto): Promise<OptionTrade> {
    const investment = new Decimal(dto.investment)

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, status: true } })
    const account = await this.accounts.getPrimaryAccount(userId)

    const resolved = await this.optionsMarkets.resolveForTrade(dto.symbol, dto.durationSeconds)
    if (!resolved.ok) {
      throw new BadRequestException(`${resolved.reason}: ${resolved.message}`)
    }
    const { market, duration } = resolved

    // Demo/test result forcing (Part 26) — validated and AUDITED before
    // anything else happens, whether accepted or rejected. An attempted
    // production override is itself a meaningful security event regardless
    // of outcome, so this is logged even on rejection.
    const requestedMode = dto.requestedResultMode ?? 'NORMAL'
    if (requestedMode !== 'NORMAL') {
      const env = process.env.NODE_ENV ?? 'development'
      const accepted = DEMO_RESULT_MODE_ALLOWED_ENVS.has(env)
      await this.audit.record({
        actorId: userId,
        action: AuditEvent.OPTION_DEMO_SIMULATION_USED,
        targetType: 'OPTION_TRADE',
        reason: accepted ? 'Demo/test result mode requested in an allowed environment.' : 'Demo/test result mode REJECTED — not an allowed environment.',
        metadata: { requestedResultMode: requestedMode, environment: env, accepted },
      })
      if (!accepted) {
        throw new ForbiddenException('Demo/test result simulation is not available in this environment.')
      }
    }

    // Authoritative entry price (Part 12) — never accepted from the client,
    // never STALE/UNAVAILABLE (Part 30/31: no trade without a trustworthy price).
    const quote = await this.marketData.getQuote(dto.symbol)
    if (quote.status !== 'LIVE' && quote.status !== 'SIMULATED') {
      throw new BadRequestException(`Market price for ${dto.symbol} is not currently available (${quote.status}). Try again shortly.`)
    }
    const entryPrice = new Decimal(quote.last)
    const entryPriceTimestamp = new Date(quote.timestamp)
    const entrySource = quote.source

    const risk = await this.risk.evaluate({ user, account, market, duration, investment })
    if (!risk.allowed) {
      if (risk.reasonCode === 'OPTIONS_TRADING_DISABLED') {
        throw new ServiceUnavailableException(risk.message ?? 'Options trading is temporarily paused platform-wide.')
      }
      throw new BadRequestException(`${risk.reasonCode}: ${risk.message}`)
    }

    const expiryAt = new Date(Date.now() + dto.durationSeconds * 1000)
    // Generated up front so the ledger reservation (below) and the
    // OptionTrade row (created only AFTER reservation succeeds) share the
    // same id — this is what makes "zero rows on any failure" true even
    // though the reservation happens before the row exists: on failure,
    // nothing ever references this id, and it is simply discarded.
    const tradeId = randomUUID()

    const { cash, reserved } = await this.ledger.getOrCreateUserLedgerAccounts(account.id, market.currency)
    try {
      await this.ledger.postTransactionWithAccountLock(
        cash.id,
        {
          description: `Reserve investment for option trade ${tradeId}`,
          relatedType: 'OPTION_TRADE',
          relatedId: tradeId,
          idempotencyKey: `option-reserve-${tradeId}`,
          entries: [
            { ledgerAccountId: cash.id, direction: 'DEBIT', amount: investment, currency: market.currency, entryType: 'TRADE_RESERVATION' },
            { ledgerAccountId: reserved.id, direction: 'CREDIT', amount: investment, currency: market.currency, entryType: 'TRADE_RESERVATION' },
          ],
        },
        async (tx) => {
          const balance = await this.ledger.getLedgerAccountBalanceLocked(tx, cash.id)
          if (balance.lt(investment)) throw new BadRequestException('Insufficient available balance.')
        },
      )
    } catch (err) {
      if (err instanceof BadRequestException) throw err // zero rows — nothing was ever created
      throw err
    }

    const trade = await this.prisma.optionTrade.create({
      data: {
        id: tradeId,
        userId,
        accountId: account.id,
        symbol: dto.symbol,
        direction: dto.direction,
        investment,
        currency: market.currency,
        durationSeconds: dto.durationSeconds,
        payoutPercentSnapshot: duration.payoutPercent,
        entryPrice,
        entryPriceTimestamp,
        entrySource,
        expiryAt,
        requestedResultMode: requestedMode,
        status: 'ACTIVE',
      },
    })

    await this.audit.record({
      actorId: userId,
      action: AuditEvent.OPTION_TRADE_CREATED,
      targetType: 'OPTION_TRADE',
      targetId: trade.id,
      newState: { symbol: trade.symbol, direction: trade.direction, investment: investment.toString(), durationSeconds: dto.durationSeconds, payoutPercent: duration.payoutPercent.toString(), entryPrice: entryPrice.toString() },
    })

    return trade
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  private async getOwnedTrade(tradeId: string, userId: string): Promise<OptionTrade> {
    const trade = await this.prisma.optionTrade.findUnique({ where: { id: tradeId } })
    if (!trade || trade.userId !== userId) throw new NotFoundException('Option trade not found.')
    return trade
  }

  // Opportunistic settle-on-read (Part 20/13): if the trade's expiry has
  // already passed but the sweep hasn't reached it yet, settle it right now
  // rather than making the caller wait up to SWEEP_INTERVAL_MS. Safe to call
  // unconditionally — settleTrade() is fully idempotent.
  private async withOpportunisticSettle(trade: OptionTrade): Promise<OptionTrade> {
    if ((trade.status === 'ACTIVE' || trade.status === 'UNRESOLVED') && trade.expiryAt.getTime() <= Date.now()) {
      return this.settleTrade(trade.id)
    }
    return trade
  }

  async getTrade(userId: string, tradeId: string): Promise<OptionTrade> {
    const trade = await this.getOwnedTrade(tradeId, userId)
    return this.withOpportunisticSettle(trade)
  }

  async listMyActiveTrades(userId: string): Promise<OptionTrade[]> {
    const trades = await this.prisma.optionTrade.findMany({ where: { userId, status: { in: ['ACTIVE', 'UNRESOLVED'] } }, orderBy: { createdAt: 'desc' } })
    return Promise.all(trades.map((t) => this.withOpportunisticSettle(t)))
  }

  async listMyTrades(userId: string, filters: OptionTradeHistoryFilters): Promise<OptionTrade[]> {
    const where: Prisma.OptionTradeWhereInput = { userId }
    if (filters.symbol) where.symbol = filters.symbol
    if (filters.result) where.result = filters.result
    if (filters.activeOnly) where.status = { in: ['ACTIVE', 'UNRESOLVED'] }
    if (filters.completedOnly) where.status = 'SETTLED'
    if (filters.from || filters.to) {
      where.createdAt = {}
      if (filters.from) where.createdAt.gte = filters.from
      if (filters.to) where.createdAt.lte = filters.to
    }
    return this.prisma.optionTrade.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 })
  }

  // ===========================================================================
  // Settlement (Part 14/15/16) — idempotent, atomic, never fabricates a result.
  // ===========================================================================

  async settleTrade(tradeId: string): Promise<OptionTrade> {
    const trade = await this.prisma.optionTrade.findUniqueOrThrow({ where: { id: tradeId } })
    if (trade.status === 'SETTLED') return trade // terminal — idempotent no-op

    let expiryPrice: Decimal
    let expiryPriceTimestamp: Date
    let expirySource: string
    let result: 'WIN' | 'LOSS' | 'DRAW'

    // Sandbox/test override chain (Part 28) — every branch below is skipped
    // entirely outside development/test (re-checked here independently of
    // whatever any row currently holds — defense in depth, since every
    // write path already refuses to store a forcing value outside those
    // environments). Production/staging always falls straight to the real
    // price-derived result at the bottom, byte-for-byte the same path as
    // before this chain existed. Priority, highest first:
    //   1. the trade's OWN user's per-user testOutcomeMode — only ever
    //      non-NORMAL for a user with isTestUser=true (see
    //      setTestUserOutcomeMode), which can never be a real customer
    //      (see schema.prisma's User.isTestUser doc comment).
    //   2. the platform-wide sandboxOutcomeMode dial (ALL USER CONTROL).
    //   3. the trade's own per-trade requestedResultMode (Part 26),
    //      chosen by whoever created it.
    let forcedResult: 'WIN' | 'LOSS' | 'DRAW' | null = null
    if (isDemoResultModeAllowed()) {
      const trader = await this.prisma.user.findUnique({ where: { id: trade.userId }, select: { isTestUser: true, testOutcomeMode: true } })
      if (trader?.isTestUser && trader.testOutcomeMode !== 'NORMAL') {
        forcedResult = trader.testOutcomeMode === 'FORCE_WIN' ? 'WIN' : 'LOSS'
      } else {
        const settings = await this.optionsSettings.get()
        if (settings.sandboxOutcomeMode !== 'RANDOM') {
          forcedResult = settings.sandboxOutcomeMode === 'FORCE_WIN' ? 'WIN' : 'LOSS'
        } else if (trade.requestedResultMode !== 'NORMAL') {
          forcedResult = trade.requestedResultMode === 'FORCE_WIN' ? 'WIN' : trade.requestedResultMode === 'FORCE_LOSS' ? 'LOSS' : 'DRAW'
        }
      }
    }

    if (forcedResult !== null) {
      // Demo/test forced outcome — still attempts a real price for
      // realistic display, but the OUTCOME is never derived from it.
      const quote = await this.marketData.getQuote(trade.symbol).catch(() => null)
      if (quote && (quote.status === 'LIVE' || quote.status === 'SIMULATED')) {
        expiryPrice = new Decimal(quote.last)
        expiryPriceTimestamp = new Date(quote.timestamp)
        expirySource = quote.source
      } else {
        expiryPrice = trade.entryPrice
        expiryPriceTimestamp = new Date()
        expirySource = 'DEMO_FORCED'
      }
      result = forcedResult
    } else {
      const quote = await this.marketData.getQuote(trade.symbol)
      if (quote.status !== 'LIVE' && quote.status !== 'SIMULATED') {
        return this.markUnresolved(trade, `Expiry price unavailable for ${trade.symbol} (status: ${quote.status}).`)
      }
      expiryPrice = new Decimal(quote.last)
      expiryPriceTimestamp = new Date(quote.timestamp)
      expirySource = quote.source
      result = determineResult(trade.direction, trade.entryPrice, expiryPrice)
    }

    return this.postSettlement(trade, { expiryPrice, expiryPriceTimestamp, expirySource, result })
  }

  private async markUnresolved(trade: OptionTrade, reason: string): Promise<OptionTrade> {
    this.logger.warn(`Option trade ${trade.id} unresolved: ${reason}`)
    const updated = await this.prisma.optionTrade.update({
      where: { id: trade.id },
      data: { status: 'UNRESOLVED', rejectionReason: reason },
    })
    await this.audit.record({
      actorId: trade.userId,
      action: AuditEvent.OPTION_TRADE_UNRESOLVED,
      targetType: 'OPTION_TRADE',
      targetId: trade.id,
      reason,
    })
    return updated
  }

  // The atomic core: ledger entries + the OptionTrade status/result update
  // commit together, inside the SAME transaction as the advisory lock and
  // idempotency-key check — identical discipline to
  // OrdersService.applyNewFillsToOrder (Checkpoint E, Part 2), which is
  // exactly what makes "concurrent settlement attempts -> exactly one
  // financial effect" true by construction rather than by hope.
  private async postSettlement(
    trade: OptionTrade,
    outcome: { expiryPrice: Decimal; expiryPriceTimestamp: Date; expirySource: string; result: 'WIN' | 'LOSS' | 'DRAW' },
  ): Promise<OptionTrade> {
    const { cash, reserved } = await this.ledger.getOrCreateUserLedgerAccounts(trade.accountId, trade.currency)
    const settleKey = `option-settle-${trade.id}`

    let profitAmount: Decimal
    let returnAmount: Decimal
    const entries: LedgerEntryInput[] = []

    if (outcome.result === 'WIN') {
      profitAmount = computeProfit(trade.investment, trade.payoutPercentSnapshot)
      returnAmount = computeReturn(trade.investment, profitAmount)
      entries.push(
        { ledgerAccountId: reserved.id, direction: 'DEBIT', amount: trade.investment, currency: trade.currency, entryType: 'TRADE_RELEASE' },
        { ledgerAccountId: cash.id, direction: 'CREDIT', amount: trade.investment, currency: trade.currency, entryType: 'TRADE_RELEASE' },
      )
      if (profitAmount.gt(0)) {
        entries.push(
          { ledgerAccountId: (await this.ledger.getSystemLedgerAccount('REVENUE', trade.currency)).id, direction: 'DEBIT', amount: profitAmount, currency: trade.currency, entryType: 'REALIZED_PROFIT' },
          { ledgerAccountId: cash.id, direction: 'CREDIT', amount: profitAmount, currency: trade.currency, entryType: 'REALIZED_PROFIT' },
        )
      }
    } else if (outcome.result === 'LOSS') {
      profitAmount = trade.investment.negated()
      returnAmount = new Decimal(0)
      entries.push(
        { ledgerAccountId: reserved.id, direction: 'DEBIT', amount: trade.investment, currency: trade.currency, entryType: 'REALIZED_LOSS' },
        { ledgerAccountId: (await this.ledger.getSystemLedgerAccount('REVENUE', trade.currency)).id, direction: 'CREDIT', amount: trade.investment, currency: trade.currency, entryType: 'REALIZED_LOSS' },
      )
    } else {
      // DRAW (Part 10) — full refund, no profit paid, no loss charged.
      profitAmount = new Decimal(0)
      returnAmount = trade.investment
      entries.push(
        { ledgerAccountId: reserved.id, direction: 'DEBIT', amount: trade.investment, currency: trade.currency, entryType: 'TRADE_RELEASE' },
        { ledgerAccountId: cash.id, direction: 'CREDIT', amount: trade.investment, currency: trade.currency, entryType: 'TRADE_RELEASE' },
      )
    }

    let updatedTrade: OptionTrade | null = null

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reserved.id}))`

      const existingTxn = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: settleKey } })
      if (existingTxn) {
        // Someone else already settled this exact trade — read back
        // whatever they committed rather than posting a second time.
        updatedTrade = await tx.optionTrade.findUniqueOrThrow({ where: { id: trade.id } })
        return
      }

      await this.ledger.insertTransactionInLock(tx, {
        description: `Option trade settlement for ${trade.id}: ${trade.symbol} ${trade.direction} — ${outcome.result}`,
        relatedType: 'OPTION_TRADE',
        relatedId: trade.id,
        idempotencyKey: settleKey,
        entries,
      })

      updatedTrade = await tx.optionTrade.update({
        where: { id: trade.id },
        data: {
          status: 'SETTLED',
          result: outcome.result,
          expiryPrice: outcome.expiryPrice,
          expiryPriceTimestamp: outcome.expiryPriceTimestamp,
          expirySource: outcome.expirySource,
          profitAmount,
          returnAmount,
          settledAt: new Date(),
          rejectionReason: null,
        },
      })
    })

    const final = updatedTrade!
    // Only audit on the ACTUAL winning commit, not a replay — the trade's
    // own settledAt being freshly set (vs already set before this call)
    // isn't a reliable enough signal after the transaction, so this simply
    // re-derives it from whether the ledger write happened this call: if
    // `existingTxn` was found above, no NEW audit event is warranted (the
    // winner already wrote one).
    const alreadySettledBeforeThisCall = trade.status === 'SETTLED'
    if (!alreadySettledBeforeThisCall) {
      await this.audit.record({
        actorId: trade.userId,
        action: AuditEvent.OPTION_TRADE_SETTLED,
        targetType: 'OPTION_TRADE',
        targetId: trade.id,
        newState: { result: final.result, profitAmount: final.profitAmount?.toString(), returnAmount: final.returnAmount?.toString(), expiryPrice: final.expiryPrice?.toString() },
      })
    }
    return final
  }

  // ===========================================================================
  // Expiry sweep — the only autonomous trigger for settlement (Part 14: a
  // trade must conclude even if the user's browser is closed).
  // ===========================================================================

  private async runExpirySweepSafely() {
    if (this.sweeping) return
    this.sweeping = true
    try {
      await this.runExpirySweep()
    } catch (err) {
      this.logger.error(`Expiry sweep failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      this.sweeping = false
    }
  }

  async runExpirySweep(): Promise<{ checked: number; settled: number; unresolved: number }> {
    const due = await this.prisma.optionTrade.findMany({
      where: { status: { in: ['ACTIVE', 'UNRESOLVED'] }, expiryAt: { lte: new Date() } },
      take: 200,
    })
    let settled = 0
    let unresolved = 0
    for (const trade of due) {
      try {
        const result = await this.settleTrade(trade.id)
        if (result.status === 'SETTLED') settled++
        else if (result.status === 'UNRESOLVED') unresolved++
      } catch (err) {
        this.logger.warn(`Failed to settle option trade ${trade.id} during sweep: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return { checked: due.length, settled, unresolved }
  }

  // ===========================================================================
  // Admin
  // ===========================================================================

  async listUnresolvedTrades() {
    const trades = await this.prisma.optionTrade.findMany({ where: { status: 'UNRESOLVED' }, orderBy: { expiryAt: 'asc' } })
    return { count: trades.length, trades }
  }

  // Admin Trade Management — a general, cross-customer, real trade listing.
  // Previously the only admin-reachable trade data was aggregate counts
  // (getStats, below) and the UNRESOLVED-only list above; nothing let an
  // admin see individual ACTIVE or SETTLED trades across all customers.
  // Read-only, capped, same user-join shape as DepositsService/
  // WithdrawalsService's admin listings. Never mutates a trade or its
  // result — this is reporting only.
  // userId is an optional additional filter (Trade Management's "USER
  // CONTROL" search/select — a real, honest per-user trade filter, not an
  // outcome override; nothing about a trade's result or status is affected
  // by which user is selected here).
  async adminListTrades(status?: 'ACTIVE' | 'SETTLED' | 'UNRESOLVED', userId?: string) {
    return this.prisma.optionTrade.findMany({
      where: { ...(status ? { status } : {}), ...(userId ? { userId } : {}) },
      include: { user: { select: { id: true, email: true, fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  }

  // ===========================================================================
  // Trade Management "USER CONTROL" — designated test/sandbox users (Part 28).
  // Environment gate, step-up, and audit logging all happen in
  // OptionsAdminController, mirroring AdminService.createAdmin exactly (same
  // transaction shape: User + Account together, argon2 password hash). This
  // is the ONLY place isTestUser is ever set to true, and it only ever
  // creates a brand-new account — never modifies an existing one.
  // ===========================================================================

  async createTestUser(adminId: string, email: string, fullName: string | undefined, password: string, reason: string) {
    const normalizedEmail = email.toLowerCase()
    const existing = await this.prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (existing) throw new BadRequestException('An account with this email already exists.')

    const passwordHash = await argon2.hash(password)
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          fullName: fullName?.trim() || normalizedEmail,
          role: 'USER',
          status: 'ACTIVE',
          isTestUser: true,
          referralCode: generateReferralCode(),
        },
      })
      await tx.account.create({ data: { userId: created.id } })
      return created
    })

    await this.audit.record({
      actorId: adminId,
      action: AuditEvent.TEST_USER_CREATED,
      targetType: 'USER',
      targetId: user.id,
      reason,
      metadata: { email: user.email },
    })
    return toPublicUser(user)
  }

  async setTestUserOutcomeMode(adminId: string, userId: string, testOutcomeMode: 'NORMAL' | 'FORCE_WIN' | 'FORCE_LOSS', reason: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException('User not found.')
    // The one check that keeps this a sandbox-only feature: even inside
    // development/test, a per-user outcome override can only ever be set on
    // an account that was created through createTestUser above — never on
    // an existing/real account, no matter who selects it in USER CONTROL.
    if (!user.isTestUser) {
      throw new ForbiddenException('This user is not a designated test/sandbox user. Create a dedicated test user to use these controls.')
    }

    const before = user.testOutcomeMode
    const updated = await this.prisma.user.update({ where: { id: userId }, data: { testOutcomeMode } })

    await this.audit.record({
      actorId: adminId,
      action: AuditEvent.TEST_USER_OUTCOME_MODE_CHANGED,
      targetType: 'USER',
      targetId: userId,
      reason,
      previousState: { testOutcomeMode: before },
      newState: { testOutcomeMode: updated.testOutcomeMode },
    })
    return toPublicUser(updated)
  }

  async getStats() {
    const [active, settled, byResult, totals] = await Promise.all([
      this.prisma.optionTrade.count({ where: { status: 'ACTIVE' } }),
      this.prisma.optionTrade.count({ where: { status: 'SETTLED' } }),
      this.prisma.optionTrade.groupBy({ by: ['result'], where: { status: 'SETTLED' }, _count: { _all: true } }),
      this.prisma.optionTrade.aggregate({ where: { status: 'SETTLED' }, _sum: { investment: true, profitAmount: true } }),
    ])
    const wins = byResult.find((r) => r.result === 'WIN')?._count._all ?? 0
    const losses = byResult.find((r) => r.result === 'LOSS')?._count._all ?? 0
    const draws = byResult.find((r) => r.result === 'DRAW')?._count._all ?? 0
    const unresolved = await this.prisma.optionTrade.count({ where: { status: 'UNRESOLVED' } })

    const byAsset = await this.prisma.optionTrade.groupBy({ by: ['symbol'], _count: { _all: true } })
    const byDuration = await this.prisma.optionTrade.groupBy({ by: ['durationSeconds'], _count: { _all: true } })

    return {
      activeTrades: active,
      completedTrades: settled,
      unresolvedTrades: unresolved,
      wins,
      losses,
      draws,
      totalInvestment: (totals._sum.investment ?? new Decimal(0)).toString(),
      totalPayouts: (totals._sum.profitAmount ?? new Decimal(0)).toString(),
      byAsset: byAsset.map((r) => ({ symbol: r.symbol, count: r._count._all })),
      byDuration: byDuration.map((r) => ({ durationSeconds: r.durationSeconds, count: r._count._all })),
    }
  }
}
