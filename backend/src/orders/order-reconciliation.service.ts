import { Inject, Injectable, Logger } from '@nestjs/common'
import { Decimal } from '@prisma/client/runtime/library'
import type { Fill, Order } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { MarketsService } from '../markets/markets.service'
import { EXECUTION_PROVIDER } from '../execution/execution.module'
import { ProviderError } from '../execution/execution-provider.types'
import type { ExecutionProvider, ProviderFill, ProviderOrderResponse, ProviderOrderStatus } from '../execution/execution-provider.types'
import { aggregateFills, aggregateTrustFills, errMessage, findLimitPriceViolation, isTerminal, reservedRemainingForOrder } from './order-fill-math'
import { SEVERITY_RANK } from './order-reconciliation.types'
import type { OrderReconciliationResult, ReconciliationCategory, ReconciliationRunSummary, ReconciliationSeverity } from './order-reconciliation.types'

const NON_TERMINAL_STATUSES = ['PENDING', 'SUBMITTED', 'OPEN', 'PARTIALLY_FILLED', 'CANCEL_PENDING']

/**
 * Phase 6F Checkpoint E — provider-vs-TRUST reconciliation. 100% read-only
 * by construction: no method on this service ever calls .create/.update/
 * .delete/.upsert on Order, Fill, or any LedgerAccount/LedgerEntry — the
 * same hard rule ledger/reconciliation.service.ts already established for
 * internal ledger reconciliation (Phase 5), now extended to compare TRUST's
 * own records against the EXECUTION PROVIDER's.
 *
 * Being pure detection is what makes "safe to run repeatedly" (Part 13/14)
 * true by construction — there is no financial effect to duplicate, ever.
 * "Safe synchronization" (Part 12) is NOT performed by this service: it
 * means the EXISTING, already-proven OrdersService.syncOrder()/cancelOrder()
 * (Checkpoint D) — reconciliation only tells you a sync is worth running,
 * it never runs one itself.
 */
@Injectable()
export class OrderReconciliationService {
  private readonly logger = new Logger('OrderReconciliationService')

  constructor(
    private readonly prisma: PrismaService,
    private readonly markets: MarketsService,
    @Inject(EXECUTION_PROVIDER) private readonly executionProvider: ExecutionProvider,
  ) {}

  async runReconciliation(): Promise<ReconciliationRunSummary> {
    const orders = await this.prisma.order.findMany({
      where: { status: { in: NON_TERMINAL_STATUSES as Order['status'][] } },
      include: { fills: true },
      orderBy: { createdAt: 'asc' },
    })

    const results: OrderReconciliationResult[] = []
    for (const order of orders) {
      try {
        results.push(await this.reconcileOrder(order))
      } catch (err) {
        // Part 13 — "never silently discard failures": an unexpected error
        // checking ONE order is itself recorded as a result (not thrown,
        // not skipped), so the run continues and the failure is visible.
        this.logger.warn(`Reconciliation check failed unexpectedly for order ${order.id}: ${errMessage(err)}`)
        results.push(this.errorResult(order, `Reconciliation check itself failed unexpectedly: ${errMessage(err)}`))
      }
    }

    return {
      runAt: new Date().toISOString(),
      ordersChecked: results.length,
      reconciled: results.filter((r) => r.severity === 'INFO').length,
      warnings: results.filter((r) => r.severity === 'WARNING').length,
      critical: results.filter((r) => r.severity === 'CRITICAL').length,
      results,
    }
  }

  // Also usable standalone (e.g. a future admin "check this one order" tool)
  // — works on any order regardless of status, not just the non-terminal
  // population runReconciliation() sweeps (Part 11 explicitly wants a
  // CANCELLED-vs-provider-FILLED check to be detectable, which requires
  // being able to check a terminal order too).
  async reconcileOrder(order: Order & { fills: Fill[] }): Promise<OrderReconciliationResult> {
    const categories: ReconciliationCategory[] = []
    const notes: string[] = []
    let severity: ReconciliationSeverity = 'INFO'
    const escalate = (s: ReconciliationSeverity) => {
      if (SEVERITY_RANK[s] > SEVERITY_RANK[severity]) severity = s
    }

    const finish = (overrides: Partial<OrderReconciliationResult> = {}): OrderReconciliationResult => ({
      orderId: order.id,
      providerOrderId: order.externalOrderId,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      trustStatus: order.status,
      providerStatus: null,
      trustFilledQuantity: order.filledQuantity.toString(),
      providerFilledQuantity: null,
      trustExecutedPrice: order.executedPrice?.toString() ?? null,
      providerExecutedPrice: null,
      trustFees: order.fee.toString(),
      providerFees: null,
      reservationExpected: null,
      reservationActual: null,
      categories: categories.length > 0 ? categories : ['RECONCILED'],
      severity,
      detectedAt: new Date().toISOString(),
      notes,
      ...overrides,
    })

    if (!order.clientOrderId) {
      // Never reached a provider (foundation path, or rejected before
      // submission) — there is genuinely nothing to compare.
      notes.push('Order never reached an execution provider.')
      return finish()
    }

    const marketConfig = await this.markets.getMarketConfig(order.symbol)
    if (!marketConfig.providerSymbol) {
      categories.push('PROVIDER_ERROR')
      escalate('WARNING')
      notes.push('This market no longer has an execution mapping configured.')
      return finish()
    }

    let providerOrder: ProviderOrderResponse
    try {
      providerOrder = await this.executionProvider.getOrderStatus({
        providerSymbol: marketConfig.providerSymbol,
        clientOrderId: order.clientOrderId,
        providerOrderId: order.externalOrderId,
      })
    } catch (err) {
      // Part 4/5 — a THROWN error is always WARNING (transient), but split
      // into two distinct categories: the provider's own "I currently
      // can't tell you" (ProviderError category UNKNOWN_PROVIDER_STATE —
      // a KNOWN order, temporarily unreportable) gets its own named
      // category rather than being lumped into generic PROVIDER_ERROR
      // (timeout/unavailable/rate-limited/etc.) — both are WARNING, but
      // they mean different things to whoever is reading the result. Both
      // are distinct from MISSING_PROVIDER_ORDER below (a clean, non-thrown
      // "not found" answer, CRITICAL — the provider isn't struggling to
      // answer, it's confidently saying "never heard of it").
      if (isProviderError(err) && err.category === 'UNKNOWN_PROVIDER_STATE') {
        categories.push('UNKNOWN_PROVIDER_STATE')
      } else {
        categories.push('PROVIDER_ERROR')
      }
      escalate('WARNING')
      notes.push(`Provider status query failed: ${errMessage(err)}`)
      return finish()
    }

    // Part 6 — MISSING_PROVIDER_ORDER: the provider answered normally (no
    // throw) but reports it has no record of this order at all
    // (status UNKNOWN, no providerOrderId) — never immediately cancel, never
    // release funds; just flag it, financially protected, for resolution.
    if (providerOrder.status === 'UNKNOWN') {
      categories.push('MISSING_PROVIDER_ORDER')
      escalate('CRITICAL')
      notes.push('Provider has no record of this order (a clean "not found" response, not a transient error).')
      return finish({ providerStatus: providerOrder.status })
    }

    let providerFills: ProviderFill[]
    try {
      providerFills = await this.executionProvider.getOrderFills({
        providerSymbol: marketConfig.providerSymbol,
        clientOrderId: order.clientOrderId,
        providerOrderId: order.externalOrderId,
      })
    } catch (err) {
      categories.push(isProviderError(err) && err.category === 'UNKNOWN_PROVIDER_STATE' ? 'UNKNOWN_PROVIDER_STATE' : 'PROVIDER_ERROR')
      escalate('WARNING')
      notes.push(`Provider fills query failed: ${errMessage(err)}`)
      return finish({ providerStatus: providerOrder.status })
    }

    // Part 8 — a provider fill ID appearing more than once WITHIN the
    // provider's own response is a provider-side data-quality issue,
    // distinct from TRUST's own dedup (which never even sees the repeat
    // applied twice — Checkpoint D's unique constraint + app-level check).
    const seenProviderFillIds = new Set<string>()
    const dedupedProviderFills: ProviderFill[] = []
    for (const pf of providerFills) {
      if (seenProviderFillIds.has(pf.providerFillId)) {
        categories.push('DUPLICATE_PROVIDER_FILL')
        escalate('WARNING')
        notes.push(`Provider fills response contains a duplicate id: ${pf.providerFillId}.`)
        continue
      }
      seenProviderFillIds.add(pf.providerFillId)
      dedupedProviderFills.push(pf)
    }

    // Part 7/8 — fills the provider reports that TRUST has no record of.
    const trustFillIds = new Set(order.fills.map((f) => f.externalFillId).filter((id): id is string => !!id))
    const missingInTrust = dedupedProviderFills.filter((f) => !trustFillIds.has(f.providerFillId))
    if (missingInTrust.length > 0) {
      // Same underlying condition, classified by what TRUST currently
      // believes: if TRUST is NOT yet FILLED, this is simply "sync hasn't
      // run yet" (MISSING_TRUST_FILL — urgent, but expected until synced).
      // If TRUST already believes the order is FILLED, an unmatched
      // provider fill on top of that is unexpected (EXTRA_PROVIDER_FILL).
      categories.push(order.status === 'FILLED' ? 'EXTRA_PROVIDER_FILL' : 'MISSING_TRUST_FILL')
      escalate('CRITICAL')
      notes.push(`Provider reports ${missingInTrust.length} fill(s) not present in TRUST: ${missingInTrust.map((f) => f.providerFillId).join(', ')}.`)

      // Part 10/#13 — a missing fill that ALSO violates the limit price is
      // its own, additionally-flagged problem (never silently accepted
      // once eventually synced).
      if (order.orderType === 'LIMIT' && order.requestedPrice) {
        for (const f of missingInTrust) {
          const violation = findLimitPriceViolation(f, order.side, order.requestedPrice)
          if (violation) {
            categories.push('INVALID_LIMIT_FILL')
            escalate('CRITICAL')
            notes.push(`Provider fill ${f.providerFillId}: ${violation}`)
          }
        }
      }
    }

    // Part 9 — cumulative quantity/price/fee, provider vs TRUST. Exact
    // Decimal equality: both sides are computed with the same Decimal
    // arithmetic (Part 9 — "do not invent arbitrary tolerances"; nothing in
    // this system's provider abstraction introduces floating-point error,
    // so none is tolerated here either).
    const providerAgg = aggregateFills(dedupedProviderFills)
    const trustAgg = aggregateTrustFills(order.fills)

    if (!providerAgg.filledQuantity.eq(trustAgg.filledQuantity)) {
      categories.push('QUANTITY_MISMATCH')
      escalate('CRITICAL')
      notes.push(`Provider cumulative quantity ${providerAgg.filledQuantity.toString()} != TRUST ${trustAgg.filledQuantity.toString()}.`)
    }
    if (providerAgg.filledQuantity.gt(0) && trustAgg.filledQuantity.gt(0) && !providerAgg.avgPrice.eq(trustAgg.avgPrice)) {
      categories.push('PRICE_MISMATCH')
      escalate('CRITICAL')
      notes.push(`Provider weighted-average price ${providerAgg.avgPrice.toString()} != TRUST ${trustAgg.avgPrice.toString()}.`)
    }
    const providerTotalFee = sumDecimals([...providerAgg.feesByAsset.values()])
    const trustTotalFee = sumDecimals([...trustAgg.feesByAsset.values()])
    if (!providerTotalFee.eq(trustTotalFee)) {
      categories.push('FEE_MISMATCH')
      escalate('CRITICAL')
      notes.push(`Provider total fee ${providerTotalFee.toString()} != TRUST ${trustTotalFee.toString()}.`)
    }

    // Part 10 — reservation reconciliation. "Actual" is read directly from
    // the ledger (a pure read: findUnique, never getOrCreate — this service
    // must never create so much as a ledger account as a side effect of
    // checking one). "Expected" uses the PROVIDER's confirmed fills (not
    // TRUST's own — the whole point is catching where they diverge).
    const spentAsset = order.side === 'BUY' ? marketConfig.quoteAsset : marketConfig.baseAsset
    const reservedAccount = await this.prisma.ledgerAccount.findUnique({
      where: { accountId_type_currency: { accountId: order.accountId, type: 'RESERVED', currency: spentAsset } },
    })
    const actualRemaining = reservedAccount ? await reservedRemainingForOrder(this.prisma, order.id, reservedAccount.id) : new Decimal(0)
    const spentSoFarPerProvider = order.side === 'BUY' ? providerAgg.notional : providerAgg.filledQuantity
    const expectedRemaining = isTerminal(order.status) ? new Decimal(0) : order.quantity.minus(spentSoFarPerProvider)

    if (!expectedRemaining.eq(actualRemaining)) {
      categories.push('RESERVATION_MISMATCH')
      escalate('CRITICAL')
      notes.push(`Expected remaining reservation ${expectedRemaining.toString()} ${spentAsset} but the ledger shows ${actualRemaining.toString()}.`)
    }

    // Part 11 — status reconciliation.
    const statusIssue = this.compareStatus(order.status, providerOrder.status)
    if (statusIssue) {
      categories.push('STATUS_MISMATCH')
      escalate(statusIssue.severity)
      notes.push(statusIssue.note)
    }

    return finish({
      providerStatus: providerOrder.status,
      providerFilledQuantity: providerAgg.filledQuantity.toString(),
      providerExecutedPrice: providerAgg.filledQuantity.gt(0) ? providerAgg.avgPrice.toString() : null,
      providerFees: providerTotalFee.toString(),
      reservationExpected: expectedRemaining.toString(),
      reservationActual: actualRemaining.toString(),
    })
  }

  // Part 11 — never downgrades a confirmed TRUST FILLED order, never
  // "fixes" a CANCELLED order because the provider reports something else.
  // Returns null for "no discrepancy" or "a discrepancy already covered by
  // a more specific category above" (this function is ONLY about the
  // status field itself, not fills/quantities, which have their own
  // checks). Severity WARNING = "safe to synchronize via the existing
  // syncOrder()/cancelOrder() — provider is simply ahead of TRUST in a
  // direction TRUST's own sync logic already handles safely." CRITICAL =
  // "TRUST's own claim is contradicted in a way sync must never resolve
  // automatically."
  private compareStatus(trustStatus: string, providerStatus: ProviderOrderStatus): { severity: ReconciliationSeverity; note: string } | null {
    const providerOpen = providerStatus === 'NEW'
    const providerPartial = providerStatus === 'PARTIALLY_FILLED'
    const providerFilled = providerStatus === 'FILLED'
    const providerCancelled = providerStatus === 'CANCELED' || providerStatus === 'PENDING_CANCEL'
    const providerTerminalBad = providerStatus === 'REJECTED' || providerStatus === 'EXPIRED'

    if (trustStatus === 'FILLED') {
      if (!providerFilled) return { severity: 'CRITICAL', note: `TRUST claims FILLED but provider reports ${providerStatus} — a confirmed fill is never downgraded.` }
      return null
    }
    if (trustStatus === 'CANCELLED') {
      if (providerFilled) return { severity: 'CRITICAL', note: 'TRUST claims CANCELLED but provider reports FILLED.' }
      return null
    }
    if (trustStatus === 'OPEN') {
      if (providerOpen) return null
      if (providerPartial || providerFilled) return { severity: 'WARNING', note: `TRUST OPEN, provider ${providerStatus} — safe to synchronize via syncOrder().` }
      if (providerCancelled) return { severity: 'WARNING', note: `TRUST OPEN, provider ${providerStatus} — safe to synchronize (provider-confirmed cancellation) via cancelOrder()/syncOrder().` }
      if (providerTerminalBad) return { severity: 'CRITICAL', note: `TRUST OPEN but provider reports ${providerStatus} — unexpected terminal state, requires investigation.` }
      return null
    }
    if (trustStatus === 'PARTIALLY_FILLED') {
      if (providerPartial) return null
      if (providerFilled) return { severity: 'WARNING', note: 'TRUST PARTIALLY_FILLED, provider FILLED — safe to synchronize the final fill via syncOrder().' }
      if (providerCancelled) return { severity: 'WARNING', note: `TRUST PARTIALLY_FILLED, provider ${providerStatus} — safe to synchronize via cancelOrder()/syncOrder() (Part 18: only the unfilled remainder releases).` }
      if (providerTerminalBad) return { severity: 'CRITICAL', note: `TRUST PARTIALLY_FILLED but provider reports ${providerStatus} — unexpected, requires investigation.` }
      return null
    }
    if (trustStatus === 'CANCEL_PENDING') {
      // A cancel is in flight — any provider terminal answer is exactly
      // what cancelOrder()/syncOrder() is waiting to resolve; not itself a
      // discrepancy.
      return null
    }
    // PENDING/SUBMITTED — inherently ambiguous-outcome states; the fill/
    // quantity checks above already surface anything actionable.
    return null
  }

  private errorResult(order: Order, note: string): OrderReconciliationResult {
    return {
      orderId: order.id,
      providerOrderId: order.externalOrderId,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      trustStatus: order.status,
      providerStatus: null,
      trustFilledQuantity: order.filledQuantity.toString(),
      providerFilledQuantity: null,
      trustExecutedPrice: order.executedPrice?.toString() ?? null,
      providerExecutedPrice: null,
      trustFees: order.fee.toString(),
      providerFees: null,
      reservationExpected: null,
      reservationActual: null,
      categories: ['PROVIDER_ERROR'],
      severity: 'WARNING',
      detectedAt: new Date().toISOString(),
      notes: [note],
    }
  }
}

function sumDecimals(values: Decimal[]): Decimal {
  return values.reduce((s, v) => s.plus(v), new Decimal(0))
}

function isProviderError(err: unknown): err is ProviderError {
  return err instanceof ProviderError
}
