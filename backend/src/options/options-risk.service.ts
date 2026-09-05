// Pre-trade risk evaluation for options trades — same ARCHITECTURE as
// RiskEngineService (one evaluate() call, before any reservation/ledger
// mutation, every limit optional/nullable meaning "not enforced"), scoped
// to the checks that actually apply to a fixed-time options trade (no
// notional/position-size/limit-price concepts here — those are spot-only).
import { Injectable } from '@nestjs/common'
import { Decimal } from '@prisma/client/runtime/library'
import type { Account, OptionMarket, OptionDuration, User } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService } from '../ledger/ledger.service'
import { OptionsSettingsService } from './options-settings.service'
import type { OptionsRiskCheckResult, OptionsRiskReasonCode } from './options-risk.types'

export interface OptionsRiskCheckContext {
  user: Pick<User, 'id' | 'status'>
  account: Pick<Account, 'id' | 'status'>
  market: OptionMarket
  duration: OptionDuration
  investment: Decimal
}

@Injectable()
export class OptionsRiskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly optionsSettings: OptionsSettingsService,
  ) {}

  async evaluate(ctx: OptionsRiskCheckContext): Promise<OptionsRiskCheckResult> {
    const fail = (code: OptionsRiskReasonCode, message: string): OptionsRiskCheckResult => ({ allowed: false, reasonCode: code, message })

    // ---- 1. Platform-wide options kill switch ------------------------------
    const settings = await this.optionsSettings.get()
    if (!settings.tradingEnabled) return fail('OPTIONS_TRADING_DISABLED', 'Options trading is temporarily paused platform-wide.')

    // ---- 2/3. Account/user eligibility (defense in depth — the session
    // guard already blocks a non-ACTIVE user before this can run) ----------
    if (ctx.account.status !== 'ACTIVE') return fail('ACCOUNT_TRADING_DISABLED', 'This account is not permitted to trade.')
    if (ctx.user.status !== 'ACTIVE') return fail('USER_NOT_ALLOWED_TO_TRADE', 'This user is not permitted to trade.')

    // ---- 4/5. Asset/duration enabled (already resolved by the caller via
    // OptionsMarketService.resolveForTrade, re-checked here defensively) ---
    if (!ctx.market.enabled) return fail('ASSET_DISABLED', `Options trading is not available for ${ctx.market.symbol}.`)
    if (!ctx.duration.enabled) return fail('DURATION_DISABLED', `The ${ctx.duration.durationSeconds}s duration is not available for ${ctx.market.symbol}.`)

    // ---- 6/8. Investment amount validation ---------------------------------
    if (!ctx.investment.isFinite() || ctx.investment.lte(0)) {
      return fail('INVALID_INVESTMENT_AMOUNT', 'Investment amount must be a positive number.')
    }
    if (ctx.investment.lt(ctx.market.minInvestment)) {
      return fail('MIN_INVESTMENT_NOT_MET', `Minimum investment for ${ctx.market.symbol} is ${ctx.market.minInvestment.toString()} ${ctx.market.currency}.`)
    }
    if (ctx.market.maxInvestment && ctx.investment.gt(ctx.market.maxInvestment)) {
      return fail('MAX_INVESTMENT_EXCEEDED', `Maximum investment for ${ctx.market.symbol} is ${ctx.market.maxInvestment.toString()} ${ctx.market.currency}.`)
    }

    // ---- Amount-tier gating (Part 29) — duration+payout are resolved
    // automatically from the investment amount on the trading UI (never a
    // manually clicked/typed duration); this is the server-side
    // enforcement that the submitted (duration, investment) pair is
    // actually a legitimate tier, never trusting whatever the client
    // resolved and sent. minAmount defaults to 0 (unenforced) for any
    // duration an admin hasn't assigned a real threshold to.
    if (ctx.duration.minAmount.gt(0) && ctx.investment.lt(ctx.duration.minAmount)) {
      return fail('DURATION_MIN_AMOUNT_NOT_MET', `The ${ctx.duration.durationSeconds}s / ${ctx.duration.payoutPercent.toString()}% tier requires a minimum investment of ${ctx.duration.minAmount.toString()} ${ctx.market.currency}.`)
    }

    // ---- 17. Concurrent-trade limits (Part 17) — global per-user ceilings,
    // same nullable-means-unenforced convention as PlatformSettings' own
    // maxOpenOrdersPerUser. ---------------------------------------------------
    if (settings.maxActiveTradesPerUser !== null && settings.maxActiveTradesPerUser !== undefined) {
      const activeCount = await this.prisma.optionTrade.count({ where: { userId: ctx.user.id, status: 'ACTIVE' } })
      if (activeCount >= settings.maxActiveTradesPerUser) {
        return fail('MAX_ACTIVE_TRADES_EXCEEDED', `You already have ${activeCount} active option trade(s), at or above the platform limit of ${settings.maxActiveTradesPerUser}.`)
      }
    }
    if (settings.maxExposurePerUser) {
      const activeTrades = await this.prisma.optionTrade.findMany({ where: { userId: ctx.user.id, status: 'ACTIVE' }, select: { investment: true } })
      const currentExposure = activeTrades.reduce((sum, t) => sum.plus(t.investment), new Decimal(0))
      const projected = currentExposure.plus(ctx.investment)
      if (projected.gt(settings.maxExposurePerUser)) {
        return fail('MAX_EXPOSURE_EXCEEDED', `This trade would bring your total active investment to ${projected.toString()}, above the platform limit of ${settings.maxExposurePerUser.toString()}.`)
      }
    }

    // ---- 7. Available-balance eligibility (Part 7) — a PRE-check only; the
    // actual race-safe guarantee comes from the advisory-locked balance
    // recheck inside the reservation transaction (same discipline as spot
    // Orders' RiskEngineService, see risk-engine.service.ts). --------------
    const available = await this.ledger.getAccountBalances(ctx.account.id, ctx.market.currency)
    if (available.cash.lt(ctx.investment)) {
      return fail('INSUFFICIENT_AVAILABLE_BALANCE', `This trade requires ${ctx.investment.toString()} ${ctx.market.currency} but only ${available.cash.toString()} is available.`)
    }

    return { allowed: true, reasonCode: null, message: null }
  }
}
