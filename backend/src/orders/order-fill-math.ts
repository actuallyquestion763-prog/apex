// Pure/shared order-fill logic (Phase 6F Checkpoint E) — extracted out of
// OrdersService so OrderReconciliationService can use the EXACT same
// validation/aggregation rules when comparing TRUST state against the
// provider, rather than a second, potentially-divergent copy (Part 1: "do
// not duplicate existing functionality"). Every function here is either
// pure or takes its Prisma dependency explicitly — nothing is a class
// method, so both services can call it identically.
import { Decimal } from '@prisma/client/runtime/library'
import type { Prisma } from '@prisma/client'
import type { PrismaService } from '../prisma/prisma.service'
import type { ProviderFill } from '../execution/execution-provider.types'

export const TERMINAL_STATUSES = new Set(['FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED'])

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status)
}

// Part 5 (Checkpoint C) fill-shape validation — never trusts a provider
// fill that is missing required fields or self-contradictory.
export function findFillProblem(fill: ProviderFill, expectedProviderOrderId: string | null): string | null {
  if (!fill.providerFillId) return 'missing providerFillId'
  if (!fill.providerOrderId) return 'missing providerOrderId'
  if (expectedProviderOrderId && fill.providerOrderId !== expectedProviderOrderId) return 'fill providerOrderId does not match the order providerOrderId'
  if (!fill.price || new Decimal(fill.price).lte(0)) return 'invalid or non-positive price'
  if (!fill.quantity || new Decimal(fill.quantity).lte(0)) return 'invalid or non-positive quantity'
  if (fill.fee === undefined || fill.fee === null || new Decimal(fill.fee).lt(0)) return 'invalid or negative fee'
  if (!fill.feeAsset) return 'missing feeAsset'
  if (!fill.executedAt || Number.isNaN(Date.parse(fill.executedAt))) return 'invalid executedAt'
  return null
}

// Part 10 (Checkpoint D) limit-price protection — a LIMIT BUY may only fill
// at or below its limit price; a LIMIT SELL may only fill at or above it.
export function findLimitPriceViolation(fill: ProviderFill, side: 'BUY' | 'SELL', limitPrice: Decimal): string | null {
  const price = new Decimal(fill.price)
  if (side === 'BUY' && price.gt(limitPrice)) {
    return `fill price ${price.toString()} exceeds the limit price ${limitPrice.toString()} for a BUY`
  }
  if (side === 'SELL' && price.lt(limitPrice)) {
    return `fill price ${price.toString()} is below the limit price ${limitPrice.toString()} for a SELL`
  }
  return null
}

export interface AggregatedFills {
  filledQuantity: Decimal
  avgPrice: Decimal
  notional: Decimal
  feesByAsset: Map<string, Decimal>
}

// SUM(quantity), weighted-average price, SUM(notional), fees grouped by
// asset — the one aggregation rule used for both TRUST's own fills and the
// provider's reported fills, so a reconciliation comparison is always
// apples-to-apples.
export function aggregateFills(fills: ProviderFill[]): AggregatedFills {
  let filledQuantity = new Decimal(0)
  let notional = new Decimal(0)
  const feesByAsset = new Map<string, Decimal>()
  for (const f of fills) {
    const qty = new Decimal(f.quantity)
    const price = new Decimal(f.price)
    filledQuantity = filledQuantity.plus(qty)
    notional = notional.plus(qty.times(price))
    const fee = new Decimal(f.fee ?? '0')
    if (fee.gt(0)) feesByAsset.set(f.feeAsset, (feesByAsset.get(f.feeAsset) ?? new Decimal(0)).plus(fee))
  }
  const avgPrice = filledQuantity.gt(0) ? notional.div(filledQuantity) : new Decimal(0)
  return { filledQuantity, avgPrice, notional, feesByAsset }
}

// Same aggregation, but directly over persisted TRUST Fill rows (Decimal
// fields already, no string parsing needed) — used when comparing TRUST's
// own recorded state rather than a fresh provider response.
export function aggregateTrustFills(fills: Array<{ quantity: Decimal; price: Decimal; fee: Decimal; feeAsset: string | null }>): AggregatedFills {
  let filledQuantity = new Decimal(0)
  let notional = new Decimal(0)
  const feesByAsset = new Map<string, Decimal>()
  for (const f of fills) {
    filledQuantity = filledQuantity.plus(f.quantity)
    notional = notional.plus(f.quantity.times(f.price))
    if (f.fee.gt(0) && f.feeAsset) feesByAsset.set(f.feeAsset, (feesByAsset.get(f.feeAsset) ?? new Decimal(0)).plus(f.fee))
  }
  const avgPrice = filledQuantity.gt(0) ? notional.div(filledQuantity) : new Decimal(0)
  return { filledQuantity, avgPrice, notional, feesByAsset }
}

// The ledger stays authoritative (Part 6/14, Checkpoint D): rather than
// storing "how much of this order's reservation remains" as a mutable
// field, it is derived on demand from every LedgerEntry this SPECIFIC
// order's LedgerTransactions have posted against its RESERVED account —
// the credit at reservation time, minus every settlement/release debit
// since. Scoped by `relatedId`, so it is correct regardless of how many
// OTHER orders share the same underlying RESERVED ledger account.
//
// Accepts either the plain PrismaService or an open Prisma.TransactionClient
// (Phase 6F Checkpoint E) — a caller holding its own advisory lock inside a
// $transaction needs THIS read to happen on that same `tx`, seeing its own
// uncommitted writes, not a separate connection that can't.
export async function reservedRemainingForOrder(
  client: Pick<Prisma.TransactionClient, 'ledgerEntry'> | PrismaService,
  orderId: string,
  reservedAccountId: string,
): Promise<Decimal> {
  const entries = await client.ledgerEntry.findMany({
    where: { ledgerAccountId: reservedAccountId, transaction: { relatedType: 'ORDER', relatedId: orderId } },
  })
  let balance = new Decimal(0)
  for (const e of entries) {
    balance = e.direction === 'CREDIT' ? balance.plus(e.amount) : balance.minus(e.amount)
  }
  return balance
}

// The maximum BASE-asset quantity an order can ever represent — for BUY,
// derived from the persisted quote reservation and limit/execution price;
// for SELL it's simply the reserved base quantity. Used both to decide
// "is this order fully filled yet" (Checkpoint D) and, here, to compute the
// expected remaining reservation for reconciliation (Part 10).
export function maxBaseQuantityForOrder(side: 'BUY' | 'SELL', quantity: Decimal, referencePrice: Decimal | null): Decimal {
  if (side === 'SELL') return quantity
  if (!referencePrice || referencePrice.lte(0)) return new Decimal(0)
  return quantity.div(referencePrice)
}

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error'
}
