// Phase 6F Checkpoint F — pure helpers for the risk engine. Kept separate
// from order-fill-math.ts (settlement-time math) since these run PRE-trade,
// before any fill exists; reuses maxBaseQuantityForOrder from there rather
// than re-deriving the same BUY/SELL asymmetric-quantity convention twice.
import { Decimal } from '@prisma/client/runtime/library'
import type { OrderStatus } from '@prisma/client'

// Part 9 — "genuinely open" states for the max-open-orders check. Excludes
// every terminal status (FILLED, CANCELLED, REJECTED, EXPIRED) exactly as
// specified; PENDING/SUBMITTED are foundation-path/in-flight-submission
// states that still tie up the user's attention/reservation even though
// they're not yet OPEN on a provider order book.
export const OPEN_ORDER_STATUSES: OrderStatus[] = ['PENDING', 'SUBMITTED', 'OPEN', 'PARTIALLY_FILLED', 'CANCEL_PENDING']

// Notional value of an order, expressed in the market's QUOTE asset —
// Part 10. Respects TRUST's existing BUY/SELL quantity convention (Phase
// 6E §7, order-fill-math.ts): for BUY, `quantity` IS the quote amount
// already; for SELL, `quantity` is a base-asset amount that must be
// converted at `price`. Exact Decimal arithmetic throughout, never a
// floating-point operation.
export function notionalQuote(side: 'BUY' | 'SELL', quantity: Decimal, price: Decimal): Decimal {
  return side === 'BUY' ? quantity : quantity.times(price)
}

// The BASE-asset quantity this order would add to (BUY) the account's
// holdings — used for the projected-position check (Part 8). SELL never
// increases holdings, so it has no projected-position-growth figure; the
// caller only calls this for BUY.
export function projectedAcquiredBaseQuantity(quantity: Decimal, price: Decimal): Decimal {
  if (price.lte(0)) return new Decimal(0)
  return quantity.div(price)
}
