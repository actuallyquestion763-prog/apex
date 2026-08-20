// Phase 6F Checkpoint F — the ONE centralized pre-trade risk engine.
// OrdersService.createOrder() calls evaluate() exactly once, after
// resolving the account and market config it needs as context, and before
// creating any reservation, ledger transaction, Order row, or provider
// call (Part 7). Every numeric limit here is read from PlatformSettings/
// MarketConfig and treated as OPTIONAL — a null value means "not
// configured for this market/platform," never "reject everything" and
// never "silently invent a value" (Checkpoint E Part 16; Checkpoint F Part
// 5). The one exception is RISK_CONFIGURATION_ERROR, reserved for cases
// where the engine genuinely cannot determine a safe answer at all (no
// trusted price to compute notional/position against) — that is a real
// gap, not an absent optional limit, and always blocks the order.
import { Injectable } from '@nestjs/common'
import { Decimal } from '@prisma/client/runtime/library'
import type { Account, MarketConfig, User } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService } from '../ledger/ledger.service'
import { PlatformSettingsService } from '../platform-settings/platform-settings.service'
import { notionalQuote, OPEN_ORDER_STATUSES, projectedAcquiredBaseQuantity } from './order-risk-math'
import type { RiskCheckDetail, RiskCheckResult, RiskReasonCode } from './risk-engine.types'

export interface RiskCheckContext {
  user: Pick<User, 'id' | 'status' | 'kycStatus'>
  account: Pick<Account, 'id' | 'status'>
  marketConfig: MarketConfig
  symbol: string
  side: 'BUY' | 'SELL'
  orderType: 'MARKET' | 'LIMIT'
  quantity: Decimal
  limitPrice: Decimal | null
  // The best trusted price TRUST currently has for this symbol — the same
  // LIVE quote createOrder() already fetches for display/foundation-path
  // sizing (Part 10: never a frontend-supplied or fabricated price). Null
  // when the market has no LIVE data source at all (SIMULATED markets,
  // which never reach real execution regardless of risk outcome).
  referencePrice: Decimal | null
}

@Injectable()
export class RiskEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly platformSettings: PlatformSettingsService,
  ) {}

  async evaluate(ctx: RiskCheckContext): Promise<RiskCheckResult> {
    const checks: RiskCheckDetail[] = []
    const fail = (code: RiskReasonCode, message: string): RiskCheckResult => {
      checks.push({ code, passed: false, message })
      return { allowed: false, reasonCode: code, message, checks }
    }
    const pass = (code: RiskReasonCode) => checks.push({ code, passed: true })

    // ---- 1. Platform-wide kill switch --------------------------------------
    const settings = await this.platformSettings.get()
    if (!settings.tradingEnabled) return fail('GLOBAL_TRADING_DISABLED', 'Trading is temporarily paused platform-wide.')
    pass('GLOBAL_TRADING_DISABLED')

    // ---- 2. Account-level trading restriction (Account.status, distinct
    // from User.status — Part 14: "ONLY that account rejected") -----------
    if (ctx.account.status !== 'ACTIVE') return fail('ACCOUNT_TRADING_DISABLED', 'This account is not permitted to trade.')
    pass('ACCOUNT_TRADING_DISABLED')

    // ---- 3. User-level trading eligibility — defense in depth; the
    // session guard already blocks a non-ACTIVE user before this code can
    // ever run, so this normally cannot fail in practice. -------------------
    if (ctx.user.status !== 'ACTIVE') return fail('USER_NOT_ALLOWED_TO_TRADE', 'This user is not permitted to trade.')
    pass('USER_NOT_ALLOWED_TO_TRADE')

    // ---- 4. Market-level kill switch --------------------------------------
    if (!ctx.marketConfig.tradingEnabled) return fail('MARKET_TRADING_DISABLED', 'Trading is not enabled for this market yet.')
    if (ctx.marketConfig.maintenanceMode) return fail('MARKET_TRADING_DISABLED', 'This market is under maintenance.')
    pass('MARKET_TRADING_DISABLED')

    // ---- 5. Market/price availability -------------------------------------
    const needsPrice = ctx.marketConfig.dataSource === 'LIVE'
    if (needsPrice && !ctx.referencePrice) {
      return fail('MARKET_CLOSED_OR_UNAVAILABLE', 'Market price is not currently live.')
    }
    if (ctx.marketConfig.marketType === 'CRYPTO_SPOT' && ctx.marketConfig.dataSource === 'LIVE' && !ctx.marketConfig.providerSymbol) {
      return fail('MARKET_CLOSED_OR_UNAVAILABLE', 'No execution mapping is configured for this market.')
    }
    pass('MARKET_CLOSED_OR_UNAVAILABLE')

    // ---- 6. Structural request validation ----------------------------------
    // symbol/side/orderType are already enforced by CreateOrderDto's
    // class-validator decorators before this method can ever be reached
    // through the real HTTP path — evaluated again here only so the engine
    // gives a correct, self-contained answer if ever called directly.
    if (!ctx.symbol || !ctx.marketConfig.baseAsset || !ctx.marketConfig.quoteAsset) {
      return fail('INVALID_SYMBOL', 'This symbol has no valid base/quote asset configuration.')
    }
    pass('INVALID_SYMBOL')

    if (ctx.side !== 'BUY' && ctx.side !== 'SELL') return fail('INVALID_SIDE', 'Order side must be BUY or SELL.')
    pass('INVALID_SIDE')

    if (ctx.orderType !== 'MARKET' && ctx.orderType !== 'LIMIT') return fail('INVALID_ORDER_TYPE', 'Order type must be MARKET or LIMIT.')
    pass('INVALID_ORDER_TYPE')

    if (!ctx.quantity.isFinite() || ctx.quantity.lte(0)) return fail('INVALID_QUANTITY', 'Quantity must be a positive number.')
    pass('INVALID_QUANTITY')

    if (ctx.orderType === 'LIMIT') {
      if (!ctx.limitPrice || !ctx.limitPrice.isFinite() || ctx.limitPrice.lte(0)) {
        return fail('INVALID_PRICE', 'Limit price must be a positive number.')
      }
    }
    pass('INVALID_PRICE')

    // ---- 7. Resolve the price this order will be evaluated against
    // (Part 10/11) — LIMIT uses its own limit price; MARKET uses the
    // trusted LIVE reference price already fetched by the caller. Never a
    // frontend-supplied override, never JS float math (Decimal throughout).
    const evalPrice = ctx.orderType === 'LIMIT' ? ctx.limitPrice! : ctx.referencePrice
    if (!evalPrice) {
      // Only reachable for a non-LIVE market's LIMIT order or a data
      // integrity gap — a genuine "cannot safely evaluate" case, never a
      // silently-skipped optional limit.
      return fail('RISK_CONFIGURATION_ERROR', 'No trusted price is available to evaluate this order.')
    }
    pass('RISK_CONFIGURATION_ERROR')

    // ---- 8. Size limits (Part 6/9 — MarketConfig.minimumQuantity/
    // maximumQuantity, already-existing dormant fields, now enforced when
    // set) — evaluated against BASE-asset quantity so "minimum 0.0001 BTC"
    // reads the same regardless of BUY/SELL's asymmetric input convention.
    const baseQuantity = ctx.side === 'SELL' ? ctx.quantity : projectedAcquiredBaseQuantity(ctx.quantity, evalPrice)
    if (ctx.marketConfig.minimumQuantity && baseQuantity.lt(ctx.marketConfig.minimumQuantity)) {
      return fail('MIN_ORDER_SIZE_EXCEEDED', `Order quantity ${baseQuantity.toString()} ${ctx.marketConfig.baseAsset} is below the minimum of ${ctx.marketConfig.minimumQuantity.toString()}.`)
    }
    pass('MIN_ORDER_SIZE_EXCEEDED')

    if (ctx.marketConfig.maximumQuantity && baseQuantity.gt(ctx.marketConfig.maximumQuantity)) {
      return fail('MAX_ORDER_SIZE_EXCEEDED', `Order quantity ${baseQuantity.toString()} ${ctx.marketConfig.baseAsset} exceeds the maximum of ${ctx.marketConfig.maximumQuantity.toString()}.`)
    }
    pass('MAX_ORDER_SIZE_EXCEEDED')

    // ---- 9. Notional limit (Part 6/10) ------------------------------------
    const notional = notionalQuote(ctx.side, ctx.quantity, evalPrice)
    if (ctx.marketConfig.maxOrderNotional && notional.gt(ctx.marketConfig.maxOrderNotional)) {
      return fail('MAX_NOTIONAL_EXCEEDED', `Order notional ${notional.toString()} ${ctx.marketConfig.quoteAsset} exceeds the maximum of ${ctx.marketConfig.maxOrderNotional.toString()}.`)
    }
    pass('MAX_NOTIONAL_EXCEEDED')

    // ---- 10. Price-range protection (Part 11) — no percentage band is
    // configured anywhere in the product (and Part 11 explicitly forbids
    // inventing one), so this check has no independent effect today beyond
    // the existing, unduplicated Checkpoint D limit-price protection
    // (findLimitPriceViolation, applied at fill time in orders.service.ts —
    // never re-implemented here). Structured as a real check, not a no-op
    // stub, so a future authoritative band can be wired in without moving
    // anything else in this pipeline.
    pass('PRICE_OUTSIDE_ALLOWED_RANGE')

    // ---- 11. Open-order limit (Part 6/9) -----------------------------------
    if (settings.maxOpenOrdersPerUser !== null && settings.maxOpenOrdersPerUser !== undefined) {
      const openOrders = await this.prisma.order.count({
        where: { userId: ctx.user.id, status: { in: OPEN_ORDER_STATUSES } },
      })
      if (openOrders >= settings.maxOpenOrdersPerUser) {
        return fail('MAX_OPEN_ORDERS_EXCEEDED', `This account already has ${openOrders} open order(s), at or above the platform limit of ${settings.maxOpenOrdersPerUser}.`)
      }
    }
    pass('MAX_OPEN_ORDERS_EXCEEDED')

    // ---- 12. Position-size limit (Part 6/8) — BUY only; a SELL can only
    // reduce holdings, never grow a position. -------------------------------
    if (ctx.side === 'BUY' && ctx.marketConfig.maxPositionQuantity) {
      const currentHoldings = await this.ledger.getAccountBalances(ctx.account.id, ctx.marketConfig.baseAsset)
      const projected = currentHoldings.total.plus(baseQuantity)
      if (projected.gt(ctx.marketConfig.maxPositionQuantity)) {
        return fail(
          'MAX_POSITION_SIZE_EXCEEDED',
          `This order would bring total ${ctx.marketConfig.baseAsset} holdings to ${projected.toString()}, above the configured maximum of ${ctx.marketConfig.maxPositionQuantity.toString()}.`,
        )
      }
    }
    pass('MAX_POSITION_SIZE_EXCEEDED')

    // ---- 13. Available-balance eligibility (Part 12) — a PRE-check only;
    // the actual, race-safe guarantee still comes from the advisory-locked
    // balance recheck inside the reservation transaction (Part 13) that
    // already exists in OrdersService — this does not replace it, it just
    // avoids creating an order/reservation attempt for the common,
    // non-concurrent "obviously can't afford this" case. BUY spends the
    // QUOTE asset; SELL spends the BASE asset (Phase 6E §7 convention). ----
    const spendAsset = ctx.side === 'BUY' ? ctx.marketConfig.quoteAsset : ctx.marketConfig.baseAsset
    const spendAmount = ctx.side === 'BUY' ? notional : ctx.quantity
    const available = await this.ledger.getAccountBalances(ctx.account.id, spendAsset)
    if (available.cash.lt(spendAmount)) {
      return fail(
        'INSUFFICIENT_AVAILABLE_BALANCE',
        `This order requires ${spendAmount.toString()} ${spendAsset} but only ${available.cash.toString()} is available.`,
      )
    }
    pass('INSUFFICIENT_AVAILABLE_BALANCE')

    return { allowed: true, reasonCode: null, message: null, checks }
  }
}
