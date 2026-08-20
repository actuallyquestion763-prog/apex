import { BadRequestException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { Decimal } from '@prisma/client/runtime/library'
import type { Fill, Order, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService } from '../ledger/ledger.service'
import type { LedgerEntryInput } from '../ledger/ledger.types'
import { MarketsService } from '../markets/markets.service'
import { AccountsService } from '../accounts/accounts.service'
import { AuditService } from '../audit/audit.service'
import { AuditEvent } from '../audit/audit-events'
import { EXECUTION_PROVIDER } from '../execution/execution.module'
import { deriveClientOrderId, newExecutionAttemptId } from '../execution/client-order-id'
import { ProviderError } from '../execution/execution-provider.types'
import type { ExecutionProvider, ProviderFill, ProviderOrderResponse, ProviderOrderStatus, ProviderSymbolInfo } from '../execution/execution-provider.types'
import type { CreateOrderDto } from './dto/create-order.dto'
import { aggregateFills, errMessage, findFillProblem, findLimitPriceViolation, isTerminal, maxBaseQuantityForOrder, reservedRemainingForOrder } from './order-fill-math'
import { RiskEngineService } from './risk-engine.service'
import type { RiskCheckResult } from './risk-engine.types'

/**
 * Order foundation (Phase 1) + real sandbox execution (Phase 6F Checkpoint C).
 *
 * Two paths, both inside createOrder():
 *
 *  1. FOUNDATION PATH (unchanged since Phase 1) — every market that is
 *     SIMULATED-data or not CRYPTO_SPOT (e.g. XAU/USD, a CFD instrument —
 *     Phase 6E's product direction explicitly excludes it from execution
 *     until a separate CFD execution model is approved). Validates,
 *     reserves, then honestly releases + rejects — there is still no
 *     broker connected for these instruments in this phase.
 *
 *  2. EXECUTION PATH (new, Checkpoint C) — CRYPTO_SPOT markets with LIVE
 *     data route through the injected ExecutionProvider (FakeExecutionProvider
 *     by default in development/test; BinanceSandboxProvider only with
 *     explicit sandbox credentials — see execution/execution-provider.factory.ts;
 *     production always resolves to DisabledExecutionProvider, so this path
 *     can never place a real order). An order here can become FILLED, but
 *     ONLY after a provider-confirmed, validated fill exists — never before.
 *
 * `quantity` (Phase 6E §7, resolved here): for BUY it is the QUOTE-asset
 * amount to spend (e.g. "spend 100 USDT"); for SELL it is the BASE-asset
 * quantity to sell (e.g. "sell 0.01 BTC"). This asymmetry mirrors Binance's
 * own real MARKET order model (quoteOrderQty for BUY, quantity for SELL)
 * rather than inventing a TRUST-specific convention.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger('OrdersService')

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly markets: MarketsService,
    private readonly accounts: AccountsService,
    private readonly audit: AuditService,
    private readonly riskEngine: RiskEngineService,
    @Inject(EXECUTION_PROVIDER) private readonly executionProvider: ExecutionProvider,
  ) {}

  // Phase 6F Checkpoint F — the full pipeline is now: validate request ->
  // authenticate (guard, before this method runs) -> account status ->
  // market status -> order validation -> RISK ENGINE -> reservation ->
  // order creation -> provider submission (Part 7). Every scattered
  // tradingEnabled/maintenanceMode/quote-freshness/limit-price check that
  // used to live inline here now lives in RiskEngineService.evaluate(),
  // called exactly once, below — never re-scattered.
  async createOrder(userId: string, dto: CreateOrderDto) {
    const quantity = new Decimal(dto.quantity)
    if (quantity.lte(0)) throw new BadRequestException('Quantity must be a positive number.')

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, status: true, kycStatus: true } })
    const account = await this.accounts.getPrimaryAccount(userId)
    const marketConfig = await this.markets.getMarketConfig(dto.symbol)

    // Generic across any LIVE-dataSource symbol (Phase 6B) — no hardcoded
    // "only XAU/USD" check needed. This display quote is NEVER used as an
    // execution price (Part 3); it exists only for display, and here, as
    // the risk engine's trusted reference price for sizing/notional
    // checks (Checkpoint F Part 10) — never a frontend-supplied price.
    let requestedPrice: Decimal | undefined
    if (marketConfig.dataSource === 'LIVE') {
      const quote = await this.markets.getQuote(dto.symbol)
      if (quote.status === 'LIVE') requestedPrice = new Decimal(quote.last)
    }

    const orderType = dto.orderType ?? 'MARKET'
    // DTO validation already guarantees presence/numeric shape for
    // orderType === 'LIMIT'; the risk engine independently re-validates
    // shape (INVALID_PRICE) rather than trusting that guarantee blindly.
    const limitPrice = orderType === 'LIMIT' && dto.limitPrice ? new Decimal(dto.limitPrice) : null

    const risk = await this.riskEngine.evaluate({
      user,
      account,
      marketConfig,
      symbol: dto.symbol,
      side: dto.side,
      orderType,
      quantity,
      limitPrice,
      referencePrice: requestedPrice ?? null,
    })

    if (!risk.allowed) {
      // GLOBAL_TRADING_DISABLED preserves its pre-existing contract exactly
      // (ServiceUnavailableException, zero rows of any kind) — every other
      // reason code preserves the pre-existing "well-formed request,
      // couldn't be fulfilled" contract (a persisted REJECTED order, no
      // reservation/ledger/provider effect — see createRiskRejectedOrder).
      // See Checkpoint F report Part 6 for why this dual contract is
      // intentional, not an oversight: changing GLOBAL_TRADING_DISABLED's
      // shape would 503->201 regress an existing passing test, and
      // changing the rest to "zero rows always" would break the existing,
      // passing concurrent-order tests that read res.body.status off a 201.
      if (risk.reasonCode === 'GLOBAL_TRADING_DISABLED') {
        throw new ServiceUnavailableException(risk.message ?? 'Trading is temporarily paused platform-wide.')
      }
      return this.createRiskRejectedOrder(userId, account.id, dto, quantity, risk, requestedPrice)
    }

    // Phase 6F Checkpoint C — route CRYPTO_SPOT LIVE markets through real
    // sandbox execution. Every other market (SIMULATED data, or a
    // non-CRYPTO_SPOT marketType such as XAU/USD's CFD) falls through to
    // the unchanged foundation path below — additive, not a replacement.
    if (marketConfig.marketType === 'CRYPTO_SPOT' && marketConfig.dataSource === 'LIVE') {
      // The risk engine's MARKET_CLOSED_OR_UNAVAILABLE check already
      // guarantees providerSymbol is set and limitPrice is a valid
      // positive Decimal by this point — never re-checked here.
      if (orderType === 'LIMIT') {
        return this.executeSpotLimitOrder({
          userId,
          accountId: account.id,
          symbol: dto.symbol,
          providerSymbol: marketConfig.providerSymbol!,
          baseAsset: marketConfig.baseAsset,
          quoteAsset: marketConfig.quoteAsset,
          side: dto.side,
          reserveAmount: quantity,
          limitPrice: limitPrice!,
        })
      }

      return this.executeSpotMarketOrder({
        userId,
        accountId: account.id,
        symbol: dto.symbol,
        providerSymbol: marketConfig.providerSymbol!,
        baseAsset: marketConfig.baseAsset,
        quoteAsset: marketConfig.quoteAsset,
        side: dto.side,
        reserveAmount: quantity,
        displayPrice: requestedPrice,
      })
    }

    if (orderType === 'LIMIT') {
      // LIMIT orders are only supported on the real execution path this
      // checkpoint — the foundation path's honest "no broker connected"
      // rejection below is MARKET-shaped (no limit-price concept), so a
      // LIMIT request against a non-CRYPTO_SPOT/LIVE market gets its own
      // clear, honest rejection instead.
      return this.createRejectedOrder(userId, account.id, dto, quantity, 'LIMIT orders are not supported for this market.', requestedPrice)
    }

    // ---- Foundation path (unchanged since Phase 1) -------------------------
    const order = await this.prisma.order.create({
      data: {
        userId,
        accountId: account.id,
        symbol: dto.symbol,
        side: dto.side,
        quantity,
        requestedPrice,
        status: 'PENDING',
      },
    })

    const { cash, reserved } = await this.ledger.getOrCreateUserLedgerAccounts(account.id)

    try {
      await this.ledger.postTransactionWithAccountLock(
        cash.id,
        {
          description: `Reserve funds for order ${order.id}`,
          relatedType: 'ORDER',
          relatedId: order.id,
          idempotencyKey: `order-reserve-${order.id}`,
          entries: [
            { ledgerAccountId: cash.id, direction: 'DEBIT', amount: quantity, entryType: 'TRADE_RESERVATION' },
            { ledgerAccountId: reserved.id, direction: 'CREDIT', amount: quantity, entryType: 'TRADE_RESERVATION' },
          ],
        },
        async (tx) => {
          const balance = await this.ledger.getLedgerAccountBalanceLocked(tx, cash.id)
          if (balance.lt(quantity)) throw new BadRequestException('Insufficient available balance.')
        },
      )
    } catch (err) {
      if (err instanceof BadRequestException) {
        return this.prisma.order.update({
          where: { id: order.id },
          data: { status: 'REJECTED', rejectionReason: 'Insufficient available balance.' },
        })
      }
      throw err
    }

    await this.ledger.postTransaction({
      description: `Release reservation — no broker connected for order ${order.id}`,
      relatedType: 'ORDER',
      relatedId: order.id,
      idempotencyKey: `order-release-${order.id}`,
      entries: [
        { ledgerAccountId: reserved.id, direction: 'DEBIT', amount: quantity, entryType: 'TRADE_RELEASE' },
        { ledgerAccountId: cash.id, direction: 'CREDIT', amount: quantity, entryType: 'TRADE_RELEASE' },
      ],
    })

    return this.prisma.order.update({
      where: { id: order.id },
      data: { status: 'REJECTED', rejectionReason: 'No broker/exchange is connected in this environment. This phase only validates and demonstrates the order/ledger foundation.' },
    })
  }

  private async createRejectedOrder(userId: string, accountId: string, dto: CreateOrderDto, quantity: Decimal, reason: string, requestedPrice?: Decimal) {
    return this.prisma.order.create({
      data: {
        userId,
        accountId,
        symbol: dto.symbol,
        side: dto.side,
        quantity,
        requestedPrice,
        status: 'REJECTED',
        rejectionReason: reason,
      },
    })
  }

  // Phase 6F Checkpoint F, Part 7/16 — a risk-engine rejection persists
  // exactly the same shape of REJECTED order as createRejectedOrder above
  // (no reservation, no ledger transaction, no provider call — see
  // createOrder's comment on why this is a deliberate, documented
  // interpretation of "no order" rather than a literal zero-row result),
  // plus a dedicated ORDER_RISK_REJECTED audit event carrying the
  // structured reason code every risk rejection must be auditable by
  // (Part 16). rejectionReason is prefixed with the machine-readable code
  // so it stays both human-readable (existing tests regex-match substrings
  // like "not enabled"/"not currently live") and parseable.
  private async createRiskRejectedOrder(
    userId: string,
    accountId: string,
    dto: CreateOrderDto,
    quantity: Decimal,
    risk: RiskCheckResult,
    requestedPrice?: Decimal,
  ) {
    const order = await this.prisma.order.create({
      data: {
        userId,
        accountId,
        symbol: dto.symbol,
        side: dto.side,
        quantity,
        requestedPrice,
        status: 'REJECTED',
        rejectionReason: `${risk.reasonCode}: ${risk.message}`,
      },
    })
    await this.audit.record({
      actorId: userId,
      action: AuditEvent.ORDER_RISK_REJECTED,
      targetType: 'ORDER',
      targetId: order.id,
      reason: risk.message ?? undefined,
      metadata: {
        symbol: dto.symbol,
        side: dto.side,
        orderType: dto.orderType ?? 'MARKET',
        quantity: quantity.toString(),
        reasonCode: risk.reasonCode ?? 'UNKNOWN',
      },
    })
    return order
  }

  async listMyOrders(userId: string) {
    return this.prisma.order.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100, include: { fills: true } })
  }

  // ===========================================================================
  // Phase 6F Checkpoint C — real sandbox execution path
  // ===========================================================================

  private async executeSpotMarketOrder(params: {
    userId: string
    accountId: string
    symbol: string
    providerSymbol: string
    baseAsset: string
    quoteAsset: string
    side: 'BUY' | 'SELL'
    reserveAmount: Decimal
    displayPrice?: Decimal
  }) {
    const { userId, accountId, symbol, providerSymbol, baseAsset, quoteAsset, side, reserveAmount, displayPrice } = params
    const spentAsset = side === 'BUY' ? quoteAsset : baseAsset
    const receivedAsset = side === 'BUY' ? baseAsset : quoteAsset

    // Part 3 step 8 / Part 10 — validate market information BEFORE ever
    // reserving funds. A provider that can't be reached here means the
    // order never reaches execution at all — no reservation is created,
    // matching Part 13's "a blocked order must never reach the provider"
    // in spirit even though this specific call is read-only.
    const validation = await this.validateSymbolInfo(providerSymbol, side, reserveAmount)
    if (!validation.ok) {
      return this.createRejectedOrder(userId, accountId, { symbol, side, quantity: reserveAmount.toString() } as CreateOrderDto, reserveAmount, validation.reason, displayPrice)
    }

    const { cash: spentCash, reserved: spentReserved } = await this.ledger.getOrCreateUserLedgerAccounts(accountId, spentAsset)
    const { cash: receivedCash } = await this.ledger.getOrCreateUserLedgerAccounts(accountId, receivedAsset)

    const order = await this.prisma.order.create({
      data: { userId, accountId, symbol, side, quantity: reserveAmount, requestedPrice: displayPrice, orderType: 'MARKET', status: 'PENDING' },
    })
    await this.audit.record({
      actorId: userId,
      action: AuditEvent.ORDER_CREATED,
      targetType: 'ORDER',
      targetId: order.id,
      newState: { symbol, side, quantity: reserveAmount.toString() },
    })

    // ---- Reserve, under lock — identical discipline to the foundation
    // path, just parameterized by whichever asset this side spends. -------
    try {
      await this.ledger.postTransactionWithAccountLock(
        spentCash.id,
        {
          description: `Reserve funds for order ${order.id}`,
          relatedType: 'ORDER',
          relatedId: order.id,
          idempotencyKey: `order-reserve-${order.id}`,
          entries: [
            { ledgerAccountId: spentCash.id, direction: 'DEBIT', amount: reserveAmount, currency: spentAsset, entryType: 'TRADE_RESERVATION' },
            { ledgerAccountId: spentReserved.id, direction: 'CREDIT', amount: reserveAmount, currency: spentAsset, entryType: 'TRADE_RESERVATION' },
          ],
        },
        async (tx) => {
          const balance = await this.ledger.getLedgerAccountBalanceLocked(tx, spentCash.id)
          if (balance.lt(reserveAmount)) throw new BadRequestException('Insufficient available balance.')
        },
      )
    } catch (err) {
      if (err instanceof BadRequestException) {
        await this.audit.record({ actorId: userId, action: AuditEvent.ORDER_REJECTED, targetType: 'ORDER', targetId: order.id, reason: 'Insufficient available balance.' })
        return this.prisma.order.update({ where: { id: order.id }, data: { status: 'REJECTED', rejectionReason: 'Insufficient available balance.' } })
      }
      throw err
    }

    // ---- Provider-facing execution idempotency (Phase 6E §22) — a stable
    // clientOrderId, generated exactly once per execution attempt, distinct
    // from the customer-facing Idempotency-Key that already wraps this
    // entire method call (see orders.controller.ts). ----------------------
    const clientOrderId = deriveClientOrderId(newExecutionAttemptId())
    await this.prisma.order.update({ where: { id: order.id }, data: { clientOrderId } })

    await this.audit.record({
      actorId: userId,
      action: AuditEvent.EXECUTION_SUBMITTED,
      targetType: 'ORDER',
      targetId: order.id,
      metadata: { clientOrderId, providerSymbol },
    })

    let response: ProviderOrderResponse
    try {
      response =
        side === 'BUY'
          ? await this.executionProvider.submitMarketOrder({ clientOrderId, providerSymbol, side, type: 'MARKET', quoteOrderQty: reserveAmount.toString() })
          : await this.executionProvider.submitMarketOrder({ clientOrderId, providerSymbol, side, type: 'MARKET', quantity: reserveAmount.toString() })
    } catch (err) {
      return this.handleSubmissionFailure(err, order, userId, spentReserved.id, spentCash.id, reserveAmount, spentAsset, clientOrderId)
    }

    await this.audit.record({
      actorId: userId,
      action: AuditEvent.EXECUTION_ACKNOWLEDGED,
      targetType: 'ORDER',
      targetId: order.id,
      metadata: { providerOrderId: response.providerOrderId, status: response.status },
    })

    return this.settleFilledOrder({
      order,
      userId,
      side,
      providerSymbol,
      response,
      spentAsset,
      receivedAsset,
      spentCashId: spentCash.id,
      spentReservedId: spentReserved.id,
      receivedCashId: receivedCash.id,
      reservedAmount: reserveAmount,
    })
  }

  // Shared by both executeSpotMarketOrder and executeSpotLimitOrder — Part
  // 3 step 8/10's "validate market information before reserving funds,"
  // extracted once rather than duplicated (Part 1: "do not duplicate
  // existing functionality").
  private async validateSymbolInfo(
    providerSymbol: string,
    side: 'BUY' | 'SELL',
    reserveAmount: Decimal,
  ): Promise<{ ok: true; info: ProviderSymbolInfo } | { ok: false; reason: string }> {
    let symbolInfo: ProviderSymbolInfo
    try {
      symbolInfo = await this.executionProvider.getSymbolInfo(providerSymbol)
    } catch (err) {
      return { ok: false, reason: `Unable to validate market information: ${errMessage(err)}` }
    }
    if (symbolInfo.status !== 'TRADING') {
      return { ok: false, reason: `Market is not currently trading on the execution provider (status: ${symbolInfo.status}).` }
    }
    if (side === 'SELL' && symbolInfo.minQuantity !== 'unsupported' && reserveAmount.lt(symbolInfo.minQuantity)) {
      return { ok: false, reason: `Order quantity is below the provider's minimum (${symbolInfo.minQuantity}).` }
    }
    if (side === 'BUY' && symbolInfo.minNotional !== 'unsupported' && reserveAmount.lt(symbolInfo.minNotional)) {
      return { ok: false, reason: `Order amount is below the provider's minimum notional (${symbolInfo.minNotional}).` }
    }
    return { ok: true, info: symbolInfo }
  }

  // ===========================================================================
  // Phase 6F Checkpoint D — LIMIT order lifecycle
  // ===========================================================================

  private async executeSpotLimitOrder(params: {
    userId: string
    accountId: string
    symbol: string
    providerSymbol: string
    baseAsset: string
    quoteAsset: string
    side: 'BUY' | 'SELL'
    reserveAmount: Decimal
    limitPrice: Decimal
  }) {
    const { userId, accountId, symbol, providerSymbol, baseAsset, quoteAsset, side, reserveAmount, limitPrice } = params
    const spentAsset = side === 'BUY' ? quoteAsset : baseAsset
    const receivedAsset = side === 'BUY' ? baseAsset : quoteAsset

    const validation = await this.validateSymbolInfo(providerSymbol, side, reserveAmount)
    if (!validation.ok) {
      return this.createRejectedOrder(userId, accountId, { symbol, side, quantity: reserveAmount.toString() } as CreateOrderDto, reserveAmount, validation.reason, limitPrice)
    }

    const { cash: spentCash, reserved: spentReserved } = await this.ledger.getOrCreateUserLedgerAccounts(accountId, spentAsset)
    const { cash: receivedCash } = await this.ledger.getOrCreateUserLedgerAccounts(accountId, receivedAsset)
    // Ensure the RESERVED account for the received asset also exists up
    // front (needed later if this order is ever cancelled/partially
    // settled and the received side needs its own ledger accounts resolved
    // consistently) — getOrCreateUserLedgerAccounts always creates the pair.
    await this.ledger.getOrCreateUserLedgerAccounts(accountId, receivedAsset)

    // requestedPrice stores the LIMIT PRICE for a LIMIT order (Part 2) —
    // the same field Checkpoint C used for MARKET's display price; the two
    // are mutually exclusive per order (orderType distinguishes them).
    const order = await this.prisma.order.create({
      data: { userId, accountId, symbol, side, quantity: reserveAmount, requestedPrice: limitPrice, orderType: 'LIMIT', status: 'PENDING' },
    })
    await this.audit.record({
      actorId: userId,
      action: AuditEvent.ORDER_CREATED,
      targetType: 'ORDER',
      targetId: order.id,
      newState: { symbol, side, quantity: reserveAmount.toString(), orderType: 'LIMIT', limitPrice: limitPrice.toString() },
    })

    // ---- Reserve, under lock — Part 5/6: BUY reserves the full quote
    // amount (the MAXIMUM possible cost at the limit price, never based on
    // the current market price); SELL reserves the base quantity. Both are
    // exactly `reserveAmount` — identical mechanism to MARKET, just now
    // representing "maximum" rather than "exact planned spend/receive"
    // since a LIMIT order may fill at a BETTER price than the limit. -----
    try {
      await this.ledger.postTransactionWithAccountLock(
        spentCash.id,
        {
          description: `Reserve funds for order ${order.id}`,
          relatedType: 'ORDER',
          relatedId: order.id,
          idempotencyKey: `order-reserve-${order.id}`,
          entries: [
            { ledgerAccountId: spentCash.id, direction: 'DEBIT', amount: reserveAmount, currency: spentAsset, entryType: 'TRADE_RESERVATION' },
            { ledgerAccountId: spentReserved.id, direction: 'CREDIT', amount: reserveAmount, currency: spentAsset, entryType: 'TRADE_RESERVATION' },
          ],
        },
        async (tx) => {
          const balance = await this.ledger.getLedgerAccountBalanceLocked(tx, spentCash.id)
          if (balance.lt(reserveAmount)) throw new BadRequestException('Insufficient available balance.')
        },
      )
    } catch (err) {
      if (err instanceof BadRequestException) {
        await this.audit.record({ actorId: userId, action: AuditEvent.ORDER_REJECTED, targetType: 'ORDER', targetId: order.id, reason: 'Insufficient available balance.' })
        return this.prisma.order.update({ where: { id: order.id }, data: { status: 'REJECTED', rejectionReason: 'Insufficient available balance.' } })
      }
      throw err
    }

    const clientOrderId = deriveClientOrderId(newExecutionAttemptId())
    await this.prisma.order.update({ where: { id: order.id }, data: { clientOrderId } })
    await this.audit.record({
      actorId: userId,
      action: AuditEvent.EXECUTION_SUBMITTED,
      targetType: 'ORDER',
      targetId: order.id,
      metadata: { clientOrderId, providerSymbol },
    })

    // Part 2 — the provider's LIMIT contract needs a base-asset quantity
    // (verified: LIMIT orders take `quantity` + `price`, never
    // `quoteOrderQty` — that's MARKET-only). For BUY, the maximum base
    // quantity representable by the quote reservation at the limit price —
    // exact Decimal division, never floating point.
    const providerQuantity = side === 'BUY' ? reserveAmount.div(limitPrice) : reserveAmount

    let response: ProviderOrderResponse
    try {
      response = await this.executionProvider.submitLimitOrder({
        clientOrderId,
        providerSymbol,
        side,
        type: 'LIMIT',
        quantity: providerQuantity.toString(),
        price: limitPrice.toString(),
      })
    } catch (err) {
      return this.handleSubmissionFailure(err, order, userId, spentReserved.id, spentCash.id, reserveAmount, spentAsset, clientOrderId)
    }

    await this.audit.record({
      actorId: userId,
      action: AuditEvent.EXECUTION_ACKNOWLEDGED,
      targetType: 'ORDER',
      targetId: order.id,
      metadata: { providerOrderId: response.providerOrderId, status: response.status },
    })

    if (response.providerSymbol !== providerSymbol || response.side !== side) {
      return this.flagUnresolved(order, userId, 'Provider response symbol/side does not match the submitted request.', {
        providerOrderId: response.providerOrderId,
        clientOrderId: response.clientOrderId,
      })
    }

    if (response.status === 'REJECTED') {
      await this.releaseReservation(order.id, spentReserved.id, spentCash.id, reserveAmount, spentAsset, 'provider rejected the order')
      await this.audit.record({ actorId: userId, action: AuditEvent.EXECUTION_REJECTED, targetType: 'ORDER', targetId: order.id, reason: response.rejectReason ?? 'Provider rejected the order.' })
      await this.audit.record({ actorId: userId, action: AuditEvent.ORDER_REJECTED, targetType: 'ORDER', targetId: order.id, reason: response.rejectReason ?? 'Provider rejected the order.' })
      return this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'REJECTED', rejectionReason: response.rejectReason ?? 'Provider rejected the order.', externalOrderId: response.providerOrderId ?? undefined },
      })
    }

    // Accepted — move to OPEN before processing any immediate fills, so the
    // externalOrderId/state is persisted even if this is the only thing
    // that happens (Part 4/7: a normally accepted LIMIT order stays OPEN,
    // never fabricated as FILLED at submission).
    await this.prisma.order.update({ where: { id: order.id }, data: { status: 'OPEN', externalOrderId: response.providerOrderId ?? undefined } })
    await this.audit.record({
      actorId: userId,
      action: AuditEvent.ORDER_OPENED,
      targetType: 'ORDER',
      targetId: order.id,
      newState: { status: 'OPEN', externalOrderId: response.providerOrderId },
    })

    const opened = await this.prisma.order.findUnique({ where: { id: order.id }, include: { fills: true } })
    if (!opened) throw new Error(`Order ${order.id} vanished immediately after creation.`)

    // A provider MAY report immediate fills even on a LIMIT submission
    // response (e.g. it crossed the book instantly) — process them exactly
    // like any other sync would, through the same incremental path used
    // for every later fill (Part 11: never assume all fills arrive at
    // createOrder() time, but also never ignore ones that do).
    if (response.fills.length > 0) {
      return this.applyNewFillsToOrder({
        order: opened,
        userId,
        side,
        providerSymbol,
        spentAsset,
        receivedAsset,
        spentCashId: spentCash.id,
        spentReservedId: spentReserved.id,
        receivedCashId: receivedCash.id,
        limitPrice,
        providerFills: response.fills,
      }).then((r) => r.order)
    }

    return this.prisma.order.findUnique({ where: { id: order.id }, include: { fills: true } })
  }

  // Part 10 — categorizes a thrown ProviderError into "confidently not
  // submitted" (safe to release the reservation and reject) vs "ambiguous"
  // (the provider may have accepted the order; funds MUST stay reserved
  // until a human/future reconciliation process resolves it via the
  // preserved clientOrderId — never guessed at, never blindly retried).
  private readonly CONFIDENT_REJECTION_CATEGORIES = new Set([
    'INVALID_REQUEST',
    'INVALID_SYMBOL',
    'INSUFFICIENT_PROVIDER_BALANCE',
    'AUTHENTICATION_FAILED',
    'MARKET_UNAVAILABLE',
    'ORDER_REJECTED',
  ])

  private async handleSubmissionFailure(
    err: unknown,
    order: Order,
    userId: string,
    spentReservedId: string,
    spentCashId: string,
    reserveAmount: Decimal,
    spentAsset: string,
    clientOrderId: string,
  ) {
    if (!(err instanceof ProviderError)) throw err // an unexpected error shape — never silently swallowed

    if (this.CONFIDENT_REJECTION_CATEGORIES.has(err.category)) {
      await this.releaseReservation(order.id, spentReservedId, spentCashId, reserveAmount, spentAsset, `provider rejected the order (${err.category})`)
      await this.audit.record({ actorId: userId, action: AuditEvent.EXECUTION_REJECTED, targetType: 'ORDER', targetId: order.id, reason: err.message, metadata: { category: err.category } })
      await this.audit.record({ actorId: userId, action: AuditEvent.ORDER_REJECTED, targetType: 'ORDER', targetId: order.id, reason: err.message })
      return this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'REJECTED', rejectionReason: `Provider rejected the order: ${err.message}` },
      })
    }

    // Ambiguous outcome (TIMEOUT, PROVIDER_UNAVAILABLE, RATE_LIMITED,
    // DUPLICATE_CLIENT_ORDER_ID, UNKNOWN_PROVIDER_STATE) — funds remain
    // reserved. `SUBMITTED` (previously dormant in the OrderStatus enum) is
    // the correct terminal-for-now state: "we told the provider, we do not
    // know what happened yet." Never PENDING → FILLED without confirmation,
    // never auto-retried, never silently released.
    await this.audit.record({
      actorId: userId,
      action: AuditEvent.EXECUTION_UNRESOLVED,
      targetType: 'ORDER',
      targetId: order.id,
      reason: err.message,
      metadata: { category: err.category, clientOrderId },
    })
    return this.prisma.order.update({
      where: { id: order.id },
      data: { status: 'SUBMITTED', rejectionReason: `Execution outcome unknown (${err.category}) — funds remain reserved pending reconciliation.` },
      include: { fills: true },
    })
  }

  private async releaseReservation(orderId: string, reservedAccountId: string, cashAccountId: string, amount: Decimal, currency: string, reasonForLog: string) {
    await this.ledger.postTransaction({
      description: `Release reservation — ${reasonForLog} (order ${orderId})`,
      relatedType: 'ORDER',
      relatedId: orderId,
      idempotencyKey: `order-release-${orderId}`,
      entries: [
        { ledgerAccountId: reservedAccountId, direction: 'DEBIT', amount, currency, entryType: 'TRADE_RELEASE' },
        { ledgerAccountId: cashAccountId, direction: 'CREDIT', amount, currency, entryType: 'TRADE_RELEASE' },
      ],
    })
  }

  // Part 5/10 — a response the provider returned synchronously but which
  // cannot be trusted enough to settle (malformed fill, symbol/side
  // mismatch, no fills for a status that implies some should exist) is
  // NEVER treated as a rejection (the provider may still have a live order)
  // and NEVER treated as a fill (nothing here was validated). It gets the
  // exact same safe, reservation-preserving treatment as a thrown ambiguous
  // ProviderError. `targetStatus` defaults to 'SUBMITTED' (Checkpoint C's
  // MARKET-order meaning: "we told the provider, outcome unknown") — an
  // already-OPEN/PARTIALLY_FILLED LIMIT order flagged unresolved should NOT
  // regress to 'SUBMITTED' (that would misrepresent an order that genuinely
  // IS resting/partially filled as merely "submitted"); callers pass the
  // order's own current status to preserve it instead.
  // Optionally scoped to an already-open, already-locked transaction (Phase
  // 6F Checkpoint E, Part 2) — callers holding a lock inside
  // applyNewFillsToOrder need this write to land atomically with the rest
  // of their transaction, not as a separate unlocked statement.
  private async flagUnresolved(
    order: Order,
    userId: string,
    reason: string,
    metadata: { providerOrderId?: string | null; clientOrderId?: string | null } = {},
    targetStatus?: Order['status'],
    tx?: Prisma.TransactionClient,
  ) {
    this.logger.warn(`Order ${order.id} flagged unresolved: ${reason}`)
    await this.audit.record(
      {
        actorId: userId,
        action: AuditEvent.EXECUTION_UNRESOLVED,
        targetType: 'ORDER',
        targetId: order.id,
        reason,
        metadata,
      },
      tx,
    )
    const data = {
      status: targetStatus ?? 'SUBMITTED',
      rejectionReason: `Execution outcome requires reconciliation: ${reason}`,
      externalOrderId: metadata.providerOrderId ?? undefined,
    }
    if (tx) {
      return tx.order.update({ where: { id: order.id }, include: { fills: true }, data })
    }
    return this.prisma.order.update({ where: { id: order.id }, include: { fills: true }, data })
  }

  private async settleFilledOrder(params: {
    order: Order
    userId: string
    side: 'BUY' | 'SELL'
    providerSymbol: string
    response: ProviderOrderResponse
    spentAsset: string
    receivedAsset: string
    spentCashId: string
    spentReservedId: string
    receivedCashId: string
    reservedAmount: Decimal
  }) {
    const { order, userId, side, providerSymbol, response, spentAsset, receivedAsset, spentCashId, spentReservedId, receivedCashId, reservedAmount } = params

    // ---- Part 5 — validate the response shape before trusting anything in it.
    if (response.providerSymbol !== providerSymbol || response.side !== side) {
      return this.flagUnresolved(order, userId, 'Provider response symbol/side does not match the submitted request.', {
        providerOrderId: response.providerOrderId,
        clientOrderId: response.clientOrderId,
      })
    }

    if (response.status === 'REJECTED') {
      await this.releaseReservation(order.id, spentReservedId, spentCashId, reservedAmount, spentAsset, 'provider rejected the order')
      await this.audit.record({ actorId: userId, action: AuditEvent.EXECUTION_REJECTED, targetType: 'ORDER', targetId: order.id, reason: response.rejectReason ?? 'Provider rejected the order.' })
      await this.audit.record({ actorId: userId, action: AuditEvent.ORDER_REJECTED, targetType: 'ORDER', targetId: order.id, reason: response.rejectReason ?? 'Provider rejected the order.' })
      return this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'REJECTED', rejectionReason: response.rejectReason ?? 'Provider rejected the order.', externalOrderId: response.providerOrderId ?? undefined },
      })
    }

    if (response.fills.length === 0) {
      return this.flagUnresolved(order, userId, 'Provider returned no fills for a MARKET order.', {
        providerOrderId: response.providerOrderId,
        clientOrderId: response.clientOrderId,
      })
    }

    for (const fill of response.fills) {
      const problem = findFillProblem(fill, response.providerOrderId)
      if (problem) {
        return this.flagUnresolved(order, userId, `Malformed provider fill: ${problem}`, {
          providerOrderId: response.providerOrderId,
          clientOrderId: response.clientOrderId,
        })
      }
    }

    const { filledQuantity, avgPrice, notional, feesByAsset } = aggregateFills(response.fills)
    if (filledQuantity.lte(0)) {
      return this.flagUnresolved(order, userId, 'Aggregate filled quantity is zero or negative.', {
        providerOrderId: response.providerOrderId,
        clientOrderId: response.clientOrderId,
      })
    }

    // Actual amounts, derived ONLY from provider fill data (Part 5) — never
    // the display price, never the reservation amount, never an estimate.
    const spentAmount = side === 'BUY' ? notional : filledQuantity
    const receivedAmount = side === 'BUY' ? filledQuantity : notional

    if (spentAmount.gt(reservedAmount)) {
      // Must never settle more than was reserved (Part 4/8's core safety
      // invariant). Structurally shouldn't happen — BUY is capped by
      // quoteOrderQty, SELL can't fill more than the reserved base
      // quantity submitted — but this is checked explicitly rather than
      // trusted, and flagged for reconciliation rather than silently
      // over-debiting if it ever somehow does.
      return this.flagUnresolved(order, userId, `Settlement would exceed the reserved amount (spent ${spentAmount.toString()} > reserved ${reservedAmount.toString()}).`, {
        providerOrderId: response.providerOrderId,
        clientOrderId: response.clientOrderId,
      })
    }
    const unusedReservation = reservedAmount.minus(spentAmount)

    // ---- Part 7/8 — one atomic transaction, per-currency balanced groups.
    const entries: LedgerEntryInput[] = [
      { ledgerAccountId: spentReservedId, direction: 'DEBIT', amount: spentAmount, currency: spentAsset, entryType: 'TRADE_SETTLEMENT' },
      { ledgerAccountId: (await this.ledger.getSystemLedgerAccount('SUSPENSE', spentAsset)).id, direction: 'CREDIT', amount: spentAmount, currency: spentAsset, entryType: 'TRADE_SETTLEMENT' },
      { ledgerAccountId: (await this.ledger.getSystemLedgerAccount('SUSPENSE', receivedAsset)).id, direction: 'DEBIT', amount: receivedAmount, currency: receivedAsset, entryType: 'TRADE_SETTLEMENT' },
      { ledgerAccountId: receivedCashId, direction: 'CREDIT', amount: receivedAmount, currency: receivedAsset, entryType: 'TRADE_SETTLEMENT' },
    ]
    if (unusedReservation.gt(0)) {
      entries.push(
        { ledgerAccountId: spentReservedId, direction: 'DEBIT', amount: unusedReservation, currency: spentAsset, entryType: 'TRADE_RELEASE' },
        { ledgerAccountId: spentCashId, direction: 'CREDIT', amount: unusedReservation, currency: spentAsset, entryType: 'TRADE_RELEASE' },
      )
    }

    // Fee entries — explicit, per Part 9, never netted into the settlement
    // amounts above. One pair per distinct feeAsset the provider reported.
    let primaryFeeAsset: string | null = null
    let totalFee = new Decimal(0)
    for (const [feeAsset, feeAmount] of feesByAsset) {
      if (feeAmount.lte(0)) continue
      const { cash: feeCash } = await this.ledger.getOrCreateUserLedgerAccounts(order.accountId, feeAsset)
      const feesSystem = await this.ledger.getSystemLedgerAccount('FEES', feeAsset)
      entries.push(
        { ledgerAccountId: feeCash.id, direction: 'DEBIT', amount: feeAmount, currency: feeAsset, entryType: 'FEE' },
        { ledgerAccountId: feesSystem.id, direction: 'CREDIT', amount: feeAmount, currency: feeAsset, entryType: 'FEE' },
      )
      // Order.fee/feeAsset is a single-value convenience summary — the
      // ledger entries above are the full, authoritative, multi-asset-safe
      // breakdown regardless of how many distinct fee assets exist.
      if (!primaryFeeAsset) primaryFeeAsset = feeAsset
      totalFee = totalFee.plus(feeAmount)
    }

    await this.ledger.postTransactionWithAccountLock(
      spentReservedId,
      {
        description: `Trade settlement for order ${order.id}: ${side} ${filledQuantity.toString()} ${providerSymbol} @ avg ${avgPrice.toString()}`,
        relatedType: 'ORDER',
        relatedId: order.id,
        idempotencyKey: `order-settle-${order.id}`,
        entries,
      },
      async (tx) => {
        const balance = await this.ledger.getLedgerAccountBalanceLocked(tx, spentReservedId)
        if (balance.lt(spentAmount.plus(unusedReservation))) {
          throw new Error(`Reserved balance insufficient at settlement time for order ${order.id} — should be structurally impossible given the earlier reservation.`)
        }
      },
    )

    // Part 6 — Fill rows preserved individually, never collapsed into one.
    await this.prisma.fill.createMany({
      data: response.fills.map((f) => ({
        orderId: order.id,
        price: new Decimal(f.price),
        quantity: new Decimal(f.quantity),
        fee: new Decimal(f.fee),
        feeAsset: f.feeAsset,
        executedAt: new Date(f.executedAt),
        externalFillId: f.providerFillId,
      })),
    })

    const finalStatus = filledQuantity.gte(new Decimal(response.requestedQuantity)) ? 'FILLED' : 'PARTIALLY_FILLED'
    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        status: finalStatus,
        executedPrice: avgPrice,
        filledQuantity,
        fee: totalFee,
        feeAsset: primaryFeeAsset,
        externalOrderId: response.providerOrderId,
      },
      include: { fills: true },
    })

    await this.audit.record({
      actorId: userId,
      action: AuditEvent.ORDER_FILLED,
      targetType: 'ORDER',
      targetId: order.id,
      newState: { status: finalStatus, filledQuantity: filledQuantity.toString(), executedPrice: avgPrice.toString() },
    })
    await this.audit.record({
      actorId: userId,
      action: AuditEvent.ASSET_BALANCE_UPDATED,
      targetType: 'ACCOUNT',
      targetId: order.accountId,
      metadata: { spentAsset, spentAmount: spentAmount.toString(), receivedAsset, receivedAmount: receivedAmount.toString() },
    })
    if (primaryFeeAsset) {
      await this.audit.record({
        actorId: userId,
        action: AuditEvent.FEE_CHARGED,
        targetType: 'ORDER',
        targetId: order.id,
        metadata: { feeAsset: primaryFeeAsset, feeAmount: totalFee.toString() },
      })
    }

    return updated
  }

  // ===========================================================================
  // Phase 6F Checkpoint D — resting-order synchronization, cancellation
  // ===========================================================================

  private async getOwnedOrder(orderId: string, userId: string): Promise<Order> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { fills: true } })
    // Same order for "doesn't exist" and "exists but isn't yours" — never
    // leak which one via the response.
    if (!order || order.userId !== userId) throw new NotFoundException('Order not found.')
    return order
  }

  // Resolves the market/asset/ledger-account context for an EXISTING order
  // — used by syncOrder/cancelOrder, which only have an orderId, not the
  // full creation-time params executeSpotLimitOrder already had in hand.
  private async getExecutionContextForOrder(order: Order) {
    const marketConfig = await this.markets.getMarketConfig(order.symbol)
    if (!marketConfig.providerSymbol) {
      throw new BadRequestException('This order\'s market no longer has an execution mapping configured.')
    }
    const spentAsset = order.side === 'BUY' ? marketConfig.quoteAsset : marketConfig.baseAsset
    const receivedAsset = order.side === 'BUY' ? marketConfig.baseAsset : marketConfig.quoteAsset
    const { cash: spentCash, reserved: spentReserved } = await this.ledger.getOrCreateUserLedgerAccounts(order.accountId, spentAsset)
    const { cash: receivedCash } = await this.ledger.getOrCreateUserLedgerAccounts(order.accountId, receivedAsset)
    return {
      providerSymbol: marketConfig.providerSymbol,
      spentAsset,
      receivedAsset,
      spentCashId: spentCash.id,
      spentReservedId: spentReserved.id,
      receivedCashId: receivedCash.id,
    }
  }

  // Part 8/11/12/13/15 — the core incremental-settlement primitive. Given
  // the FULL current list of provider fills for an order, applies only the
  // ones TRUST hasn't recorded yet (deduplicated by providerFillId, backed
  // by the DB's real @@unique([orderId, externalFillId]) constraint — see
  // schema.prisma), settles them in one atomic transaction, and recomputes
  // the order's cumulative totals from every Fill row (old + new) rather
  // than trusting a running total. Never touches an already-terminal order.
  private async applyNewFillsToOrder(params: {
    order: Order
    userId: string
    side: 'BUY' | 'SELL'
    providerSymbol: string
    spentAsset: string
    receivedAsset: string
    spentCashId: string
    spentReservedId: string
    receivedCashId: string
    limitPrice: Decimal
    providerFills: ProviderFill[]
  }): Promise<{ order: Order; newFillsApplied: number; anomaly: boolean }> {
    const { order, userId, side, spentAsset, receivedAsset, spentCashId, spentReservedId, receivedCashId, limitPrice, providerFills } = params

    if (isTerminal(order.status)) {
      return { order, newFillsApplied: 0, anomaly: false }
    }

    const existing = await this.prisma.fill.findMany({ where: { orderId: order.id }, select: { externalFillId: true } })
    const knownFillIds = new Set(existing.map((f) => f.externalFillId).filter((id): id is string => !!id))
    const newFills = providerFills.filter((f) => !knownFillIds.has(f.providerFillId))

    if (newFills.length === 0) {
      // Phase 6F Checkpoint E, Part 2 — under concurrency, "no new fills"
      // can mean EITHER "genuinely nothing to do" OR "another concurrent
      // caller already applied this exact fill between when THIS call's
      // `order` param was read (at the top of syncOrder()/cancelOrder())
      // and this dedup check just now." In the second case, the winner may
      // already have advanced the order to PARTIALLY_FILLED/FILLED — never
      // return the stale `order` param here, which would report a
      // regressed status. Re-read fresh.
      const current = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { fills: true } })
      return { order: current, newFillsApplied: 0, anomaly: false }
    }

    // Part 5/10 validation (malformed fill / limit-price protection) and the
    // reservation-sufficiency check both depend on current DB state, so
    // BOTH now run only after the lock, on the confirmed winner (below) —
    // never here, pre-lock. Running them here let a losing concurrent
    // caller observe a snapshot from BEFORE the winner settled (so the
    // reservation looked "insufficient" simply because it had already been
    // spent by the batch this caller is ITSELF trying to apply), wrongly
    // flag a successful settlement as an anomaly, and overwrite the
    // winner's committed status with this caller's own stale pre-race
    // snapshot. Evaluated only on the winner, inside the lock, neither
    // check can ever be a false positive from a concurrent replay.
    const { filledQuantity: newQty, notional: newNotional, feesByAsset } = aggregateFills(newFills)
    const newSpentAmount = side === 'BUY' ? newNotional : newQty
    const newReceivedAmount = side === 'BUY' ? newQty : newNotional

    // ---- Settle this batch — Part 7/8, same entry shape as MARKET
    // settlement, scaled to just the new fills' amounts. -------------------
    const entries: LedgerEntryInput[] = [
      { ledgerAccountId: spentReservedId, direction: 'DEBIT', amount: newSpentAmount, currency: spentAsset, entryType: 'TRADE_SETTLEMENT' },
      { ledgerAccountId: (await this.ledger.getSystemLedgerAccount('SUSPENSE', spentAsset)).id, direction: 'CREDIT', amount: newSpentAmount, currency: spentAsset, entryType: 'TRADE_SETTLEMENT' },
      { ledgerAccountId: (await this.ledger.getSystemLedgerAccount('SUSPENSE', receivedAsset)).id, direction: 'DEBIT', amount: newReceivedAmount, currency: receivedAsset, entryType: 'TRADE_SETTLEMENT' },
      { ledgerAccountId: receivedCashId, direction: 'CREDIT', amount: newReceivedAmount, currency: receivedAsset, entryType: 'TRADE_SETTLEMENT' },
    ]
    let primaryFeeAsset: string | null = order.feeAsset
    let addedFee = new Decimal(0)
    for (const [feeAsset, feeAmount] of feesByAsset) {
      if (feeAmount.lte(0)) continue
      const { cash: feeCash } = await this.ledger.getOrCreateUserLedgerAccounts(order.accountId, feeAsset)
      const feesSystem = await this.ledger.getSystemLedgerAccount('FEES', feeAsset)
      entries.push(
        { ledgerAccountId: feeCash.id, direction: 'DEBIT', amount: feeAmount, currency: feeAsset, entryType: 'FEE' },
        { ledgerAccountId: feesSystem.id, direction: 'CREDIT', amount: feeAmount, currency: feeAsset, entryType: 'FEE' },
      )
      if (!primaryFeeAsset) primaryFeeAsset = feeAsset
      addedFee = addedFee.plus(feeAmount)
    }

    // Idempotency key includes every fill id in this batch — a genuine
    // duplicate call with the exact same new-fill set (e.g. a concurrent
    // sync race) resolves to the SAME transaction rather than double
    // posting; a DIFFERENT batch (even for the same order) gets its own
    // key. This is defense in depth on top of the fill-dedup check above
    // and the DB's real unique constraint on Fill.
    //
    // Phase 6F Checkpoint E, Part 2 — everything below (ledger entries,
    // Fill rows, the residual-reservation release, and the Order status
    // update) happens INSIDE ONE advisory-locked $transaction. This is the
    // actual fix for "concurrent sync writes duplicate audit rows": an
    // earlier version only wrapped the ledger entries in the lock and did
    // the Fill/Order writes as separate steps afterward — which left a real
    // window where a "losing" concurrent caller could race past the
    // ledger's own idempotency check (correctly getting created:false) but
    // then read the Order/Fill rows BEFORE the winning caller's own
    // Fill/Order writes had committed, observing a stale, not-yet-updated
    // snapshot. Folding every write into the SAME transaction as the lock
    // means: whichever caller acquires the lock second cannot observe
    // ANYTHING until the first caller's ENTIRE bundle has committed and the
    // lock has been released — there is no partial-completion window left
    // to race into.
    const settleKey = `order-fill-settle-${order.id}-${newFills.map((f) => f.providerFillId).sort().join(',')}`
    let created = false
    let anomaly = false
    let updatedOrder: (Order & { fills: Fill[] }) | null = null

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${spentReservedId}))`

      const existingTxn = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: settleKey } })
      if (existingTxn) {
        // Someone else already applied this exact fill batch — read back
        // whatever THAT transaction committed (guaranteed complete, since
        // it happened inside the same lock this call just acquired).
        updatedOrder = await tx.order.findUniqueOrThrow({ where: { id: order.id }, include: { fills: true } })
        return
      }

      // Confirmed winner — safe to validate against CURRENT state (Part
      // 5/10/2), holding the lock the whole time.
      const currentOrder = await tx.order.findUniqueOrThrow({ where: { id: order.id } })

      for (const fill of newFills) {
        const problem = findFillProblem(fill, order.externalOrderId) ?? findLimitPriceViolation(fill, side, limitPrice)
        if (problem) {
          updatedOrder = await this.flagUnresolved(
            order,
            userId,
            `Malformed or invalid fill (providerFillId=${fill.providerFillId}): ${problem}`,
            { providerOrderId: order.externalOrderId, clientOrderId: order.clientOrderId },
            currentOrder.status,
            tx,
          )
          anomaly = true
          return
        }
      }

      const reservedRemaining = await reservedRemainingForOrder(tx, order.id, spentReservedId)
      if (newSpentAmount.gt(reservedRemaining)) {
        updatedOrder = await this.flagUnresolved(
          order,
          userId,
          `New fills would spend ${newSpentAmount.toString()} ${spentAsset} but only ${reservedRemaining.toString()} remains reserved for this order.`,
          { providerOrderId: order.externalOrderId, clientOrderId: order.clientOrderId },
          currentOrder.status,
          tx,
        )
        anomaly = true
        return
      }

      const balance = await this.ledger.getLedgerAccountBalanceLocked(tx, spentReservedId)
      if (balance.lt(0)) throw new Error(`Reserved account balance went negative settling order ${order.id} — invariant violation.`)

      await this.ledger.insertTransactionInLock(tx, {
        description: `Incremental fill settlement for order ${order.id} (${newFills.length} new fill(s))`,
        relatedType: 'ORDER',
        relatedId: order.id,
        idempotencyKey: settleKey,
        entries,
      })

      // DB-level dedup (Part 11/13): the @@unique([orderId, externalFillId])
      // constraint is the real guard against a race applying the same fill
      // twice; createMany here is the normal, expected path.
      await tx.fill.createMany({
        data: newFills.map((f) => ({
          orderId: order.id,
          price: new Decimal(f.price),
          quantity: new Decimal(f.quantity),
          fee: new Decimal(f.fee),
          feeAsset: f.feeAsset,
          executedAt: new Date(f.executedAt),
          externalFillId: f.providerFillId,
        })),
        skipDuplicates: true,
      })

      // Recompute CUMULATIVE totals from every Fill row (old + new) — never
      // trust a running total alone (Part 6). Read on the SAME `tx`, so
      // this sees the rows just inserted above.
      const allFills = await tx.fill.findMany({ where: { orderId: order.id } })
      const cumFilledQty = allFills.reduce((s, f) => s.plus(f.quantity), new Decimal(0))
      const cumNotional = allFills.reduce((s, f) => s.plus(new Decimal(f.quantity).times(f.price)), new Decimal(0))
      const cumAvgPrice = cumFilledQty.gt(0) ? cumNotional.div(cumFilledQty) : new Decimal(0)
      const cumFee = allFills.reduce((s, f) => s.plus(f.fee), new Decimal(0))

      // The maximum BASE-asset quantity this order can ever represent — for
      // BUY, derived from the persisted quote reservation and limit price
      // (both stored on the order at creation, Part 9); for SELL it's
      // simply the reserved base quantity. Same unit as cumFilledQty either way.
      const maxBaseQuantity = maxBaseQuantityForOrder(side, order.quantity, order.requestedPrice)
      const isFullyFilled = cumFilledQty.gte(maxBaseQuantity)

      if (isFullyFilled) {
        const remaining = await reservedRemainingForOrder(tx, order.id, spentReservedId)
        if (remaining.gt(0)) {
          await this.ledger.insertTransactionInLock(tx, {
            description: `Release reservation — residual reservation after full fill (order ${order.id})`,
            relatedType: 'ORDER',
            relatedId: order.id,
            idempotencyKey: `order-release-${order.id}`,
            entries: [
              { ledgerAccountId: spentReservedId, direction: 'DEBIT', amount: remaining, currency: spentAsset, entryType: 'TRADE_RELEASE' },
              { ledgerAccountId: spentCashId, direction: 'CREDIT', amount: remaining, currency: spentAsset, entryType: 'TRADE_RELEASE' },
            ],
          })
        }
      }

      const newStatus = isFullyFilled ? 'FILLED' : 'PARTIALLY_FILLED'
      updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: { status: newStatus, executedPrice: cumAvgPrice, filledQuantity: cumFilledQty, fee: cumFee, feeAsset: primaryFeeAsset },
        include: { fills: true },
      })
      created = true
    })

    if (anomaly) {
      return { order: updatedOrder!, newFillsApplied: 0, anomaly: true }
    }

    if (!created) {
      // No Fill insert, no cumulative recompute, no audit event here —
      // those already happened exactly once, atomically, inside the
      // winning caller's own transaction above.
      return { order: updatedOrder!, newFillsApplied: 0, anomaly: false }
    }

    const updated = updatedOrder!
    const cumFilledQty = updated.filledQuantity
    const cumAvgPrice = updated.executedPrice ?? new Decimal(0)
    const newStatus = updated.status

    await this.audit.record({
      actorId: userId,
      action: newStatus === 'FILLED' ? AuditEvent.ORDER_FILLED : AuditEvent.ORDER_PARTIALLY_FILLED,
      targetType: 'ORDER',
      targetId: order.id,
      newState: { status: newStatus, filledQuantity: cumFilledQty.toString(), executedPrice: cumAvgPrice.toString(), newFillsThisBatch: newFills.length },
    })
    await this.audit.record({
      actorId: userId,
      action: AuditEvent.ASSET_BALANCE_UPDATED,
      targetType: 'ACCOUNT',
      targetId: order.accountId,
      metadata: { spentAsset, spentAmount: newSpentAmount.toString(), receivedAsset, receivedAmount: newReceivedAmount.toString() },
    })
    if (addedFee.gt(0)) {
      await this.audit.record({
        actorId: userId,
        action: AuditEvent.FEE_CHARGED,
        targetType: 'ORDER',
        targetId: order.id,
        metadata: { feeAsset: primaryFeeAsset, feeAmount: addedFee.toString() },
      })
    }

    return { order: updated, newFillsApplied: newFills.length, anomaly: false }
  }

  // Part 12 — the explicit, on-demand synchronization operation (no
  // background polling loop). Retrieves provider status + fills, applies
  // any unseen fills, and reflects the provider's terminal status
  // (CANCELED/EXPIRED) if applicable. Safe to call repeatedly: with no new
  // fills and no status change, it is a pure no-op (Part 23 — no duplicate
  // audit events).
  async syncOrder(orderId: string, userId: string): Promise<Order> {
    const order = await this.getOwnedOrder(orderId, userId)
    if (isTerminal(order.status) || !order.clientOrderId) {
      return order
    }

    const ctx = await this.getExecutionContextForOrder(order)

    let status: ProviderOrderResponse
    let fills: ProviderFill[]
    try {
      status = await this.executionProvider.getOrderStatus({ providerSymbol: ctx.providerSymbol, clientOrderId: order.clientOrderId })
      // Phase 6F Checkpoint H (live testnet verification) — providerOrderId
      // MUST be passed through whenever it's already known (persisted on
      // the order from its original acceptance). A real provider's fills
      // endpoint (e.g. Binance's /v3/myTrades) can only be reliably scoped
      // to ONE order via its own numeric order ID; symbol-only scoping
      // returns every fill for that symbol across every order the account
      // has ever placed. Found live: syncing a still-resting LIMIT order
      // picked up an unrelated order's fill and correctly (but pointlessly)
      // flagged the whole order unresolved via findFillProblem's
      // providerOrderId mismatch check — a real functional bug, not a
      // hypothetical, on any account with more than one order per symbol.
      fills = await this.executionProvider.getOrderFills({ providerSymbol: ctx.providerSymbol, clientOrderId: order.clientOrderId, providerOrderId: order.externalOrderId })
    } catch (err) {
      // Provider unreachable during sync — leave state exactly as-is,
      // never fabricate (Part 12: "if provider status is unknown, do not
      // fabricate a state").
      this.logger.warn(`syncOrder(${orderId}): provider query failed: ${errMessage(err)}`)
      return order
    }

    if (status.status === 'UNKNOWN') {
      return order // genuinely unknown — no-op, stays exactly as-is
    }

    return this.reconcileOrderWithProvider({ order, userId, providerStatus: status, providerFills: fills, ...ctx })
  }

  // Shared by syncOrder and cancelOrder — Part 12 steps 4-9: apply any new
  // fills, then reflect the provider's own terminal status if the order
  // isn't already terminal after that (Part 17: a fill always wins over a
  // cancellation if the provider's final word is FILLED).
  private async reconcileOrderWithProvider(params: {
    order: Order
    userId: string
    providerSymbol: string
    spentAsset: string
    receivedAsset: string
    spentCashId: string
    spentReservedId: string
    receivedCashId: string
    providerStatus: ProviderOrderResponse
    providerFills: ProviderFill[]
  }): Promise<Order> {
    const { order, userId, providerSymbol, spentAsset, receivedAsset, spentCashId, spentReservedId, receivedCashId, providerStatus, providerFills } = params

    const { order: afterFills, anomaly } = await this.applyNewFillsToOrder({
      order,
      userId,
      side: order.side,
      providerSymbol,
      spentAsset,
      receivedAsset,
      spentCashId,
      spentReservedId,
      receivedCashId,
      limitPrice: order.requestedPrice!,
      providerFills,
    })
    if (anomaly || isTerminal(afterFills.status)) {
      return afterFills // either flagged for reconciliation, or just became FILLED — Part 17: a fill always wins, nothing further to do
    }

    if (providerStatus.status === 'CANCELED') {
      const remaining = await reservedRemainingForOrder(this.prisma, order.id, spentReservedId)
      if (remaining.gt(0)) {
        await this.releaseReservation(order.id, spentReservedId, spentCashId, remaining, spentAsset, 'provider confirmed cancellation')
      }
      const updated = await this.prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' }, include: { fills: true } })
      await this.audit.record({ actorId: userId, action: AuditEvent.ORDER_CANCELLED, targetType: 'ORDER', targetId: order.id, newState: { status: 'CANCELLED' } })
      return updated
    }

    if (providerStatus.status === 'EXPIRED') {
      // No expiration engine exists this checkpoint (Part 22) — but if a
      // provider genuinely reports EXPIRED, it is never misrepresented.
      const remaining = await reservedRemainingForOrder(this.prisma, order.id, spentReservedId)
      if (remaining.gt(0)) {
        await this.releaseReservation(order.id, spentReservedId, spentCashId, remaining, spentAsset, 'provider reported expiry')
      }
      const updated = await this.prisma.order.update({ where: { id: order.id }, data: { status: 'EXPIRED' }, include: { fills: true } })
      await this.audit.record({ actorId: userId, action: AuditEvent.ORDER_CANCELLED, targetType: 'ORDER', targetId: order.id, reason: 'Provider reported EXPIRED.', newState: { status: 'EXPIRED' } })
      return updated
    }

    // NEW / PARTIALLY_FILLED / PENDING_CANCEL — order already reflects
    // whatever fills exist; no further transition.
    return afterFills
  }

  // Part 16/17/18/19 — provider-confirmed cancellation. Never marks
  // CANCELLED merely because a cancel request was sent.
  async cancelOrder(orderId: string, userId: string): Promise<Order> {
    const order = await this.getOwnedOrder(orderId, userId)

    if (isTerminal(order.status)) {
      return order // Part 18/19 — a filled/cancelled/rejected order cannot be re-cancelled; idempotent no-op
    }
    if (!order.clientOrderId) {
      throw new BadRequestException('This order was never submitted to an execution provider and cannot be cancelled this way.')
    }

    const ctx = await this.getExecutionContextForOrder(order)

    if (order.status === 'CANCEL_PENDING') {
      // Already requested — idempotent (Part 19): re-check status rather
      // than issuing a second provider cancel call.
      return this.syncOrder(orderId, userId)
    }

    const pending = await this.prisma.order.update({ where: { id: order.id }, data: { status: 'CANCEL_PENDING' }, include: { fills: true } })
    await this.audit.record({ actorId: userId, action: AuditEvent.ORDER_CANCEL_REQUESTED, targetType: 'ORDER', targetId: order.id })

    let response: ProviderOrderResponse
    try {
      response = await this.executionProvider.cancelOrder({ providerSymbol: ctx.providerSymbol, clientOrderId: order.clientOrderId })
    } catch (err) {
      if (err instanceof ProviderError && this.CONFIDENT_REJECTION_CATEGORIES.has(err.category)) {
        // The provider refused the cancel request itself (e.g. unknown
        // order) — resolve via a status query rather than assuming anything.
        return this.syncOrder(orderId, userId)
      }
      // Ambiguous (timeout/unavailable/etc.) — stay in CANCEL_PENDING,
      // reservation untouched, flagged for reconciliation.
      await this.audit.record({ actorId: userId, action: AuditEvent.EXECUTION_UNRESOLVED, targetType: 'ORDER', targetId: order.id, reason: errMessage(err) })
      return pending
    }

    let fills: ProviderFill[]
    try {
      // See the identical fix/comment in syncOrder above — response.providerOrderId
      // (from the cancel call just made) is a fallback for the rare case
      // order.externalOrderId somehow wasn't persisted yet.
      fills = await this.executionProvider.getOrderFills({ providerSymbol: ctx.providerSymbol, clientOrderId: order.clientOrderId, providerOrderId: order.externalOrderId ?? response.providerOrderId })
    } catch {
      fills = response.fills ?? []
    }

    return this.reconcileOrderWithProvider({ order: pending, userId, providerStatus: response, providerFills: fills, ...ctx })
  }
}
