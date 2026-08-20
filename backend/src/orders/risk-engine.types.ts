// Phase 6F Checkpoint F — the centralized pre-trade risk engine's public
// contract. Every reason code here is one of the 18 required by Checkpoint
// F Part 4; nothing here is invented business logic, just the shape a
// caller (OrdersService, tests, a future admin risk-review screen) can rely
// on regardless of which specific check produced the result.
export const RISK_REASON_CODES = [
  'GLOBAL_TRADING_DISABLED',
  'MARKET_TRADING_DISABLED',
  'ACCOUNT_TRADING_DISABLED',
  'USER_NOT_ALLOWED_TO_TRADE',
  'INVALID_SYMBOL',
  'INVALID_SIDE',
  'INVALID_ORDER_TYPE',
  'INVALID_QUANTITY',
  'MIN_ORDER_SIZE_EXCEEDED',
  'MAX_ORDER_SIZE_EXCEEDED',
  'MAX_NOTIONAL_EXCEEDED',
  'MAX_OPEN_ORDERS_EXCEEDED',
  'MAX_POSITION_SIZE_EXCEEDED',
  'INSUFFICIENT_AVAILABLE_BALANCE',
  'INVALID_PRICE',
  'PRICE_OUTSIDE_ALLOWED_RANGE',
  'MARKET_CLOSED_OR_UNAVAILABLE',
  'RISK_CONFIGURATION_ERROR',
] as const

export type RiskReasonCode = (typeof RISK_REASON_CODES)[number]

export interface RiskCheckDetail {
  code: RiskReasonCode
  passed: boolean
  message?: string
}

export interface RiskCheckResult {
  allowed: boolean
  // null when allowed — there is no single failing check to name.
  reasonCode: RiskReasonCode | null
  message: string | null
  // Every check the engine actually evaluated, in evaluation order, up to
  // and including the first failure (the engine short-circuits — Part 3
  // doesn't require exhaustive evaluation, and most checks are cheap DB
  // reads that shouldn't run once an earlier one has already failed).
  checks: RiskCheckDetail[]
}
