// Phase 6F Checkpoint E — the structured result model for provider-vs-TRUST
// order reconciliation. Deliberately data, not free-form text: every
// discrepancy TRUST can detect gets its own named category so a caller
// (admin tooling, a future automated alert) can branch on `.categories`
// rather than parsing a message string.

export type ReconciliationCategory =
  | 'RECONCILED'
  | 'MISSING_PROVIDER_ORDER'
  | 'MISSING_TRUST_FILL'
  | 'EXTRA_PROVIDER_FILL'
  | 'DUPLICATE_PROVIDER_FILL'
  | 'QUANTITY_MISMATCH'
  | 'PRICE_MISMATCH'
  | 'FEE_MISMATCH'
  | 'STATUS_MISMATCH'
  | 'RESERVATION_MISMATCH'
  | 'INVALID_LIMIT_FILL'
  | 'UNKNOWN_PROVIDER_STATE'
  | 'PROVIDER_ERROR'

export type ReconciliationSeverity = 'INFO' | 'WARNING' | 'CRITICAL'

// Ordered worst-to-best is the wrong direction for a simple max() — this
// gives each severity a rank so `escalate()` can track "the worst severity
// seen so far" with a plain numeric comparison.
export const SEVERITY_RANK: Record<ReconciliationSeverity, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 }

// Never includes provider credentials, session tokens, or any secret —
// every field here is either an identifier, a monetary amount (as a
// string, Decimal-exact), a status string, or a short diagnostic note.
export interface OrderReconciliationResult {
  orderId: string
  providerOrderId: string | null
  clientOrderId: string | null
  symbol: string
  trustStatus: string
  providerStatus: string | null
  trustFilledQuantity: string
  providerFilledQuantity: string | null
  trustExecutedPrice: string | null
  providerExecutedPrice: string | null
  trustFees: string
  providerFees: string | null
  reservationExpected: string | null
  reservationActual: string | null
  categories: ReconciliationCategory[]
  severity: ReconciliationSeverity
  detectedAt: string
  // Short, non-secret diagnostic notes — one per category that needed
  // elaboration beyond what the structured fields already say.
  notes: string[]
}

export interface ReconciliationRunSummary {
  runAt: string
  ordersChecked: number
  reconciled: number
  warnings: number
  critical: number
  results: OrderReconciliationResult[]
}
