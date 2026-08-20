import { randomUUID } from 'crypto'

// Provider-facing execution idempotency (Phase 6E §22, Step 4) — a SEPARATE
// concept from the customer-facing Idempotency-Key header
// (common/idempotency/idempotency.service.ts). That mechanism dedupes an
// HTTP REQUEST from a customer; this one dedupes an EXECUTION ATTEMPT
// against the provider. A single customer request could, in principle,
// involve more than one execution attempt over its lifetime (e.g. a future
// internal retry policy) — each attempt gets its own attemptId and
// therefore its own clientOrderId; the customer-facing key never changes.
//
// Verified against Binance's real Spot API docs (New Order,
// `newClientOrderId`): "A unique id among open orders... Orders with the
// same newClientOrderID can be accepted only when the previous one is
// filled, otherwise the order will be rejected." Two consequences that
// shape this design:
//   1. The SAME execution attempt retried (e.g. after a local crash before
//      the HTTP call was even sent) must reuse the SAME clientOrderId — the
//      whole point is that Binance's own uniqueness rule then either (a)
//      returns the existing order's state if it was already accepted, or
//      (b) genuinely accepts it if the first attempt never reached Binance
//      at all. Either way this is exactly the safe "query first" pattern
//      Step 13 requires, not a source of duplicate orders.
//   2. A DIFFERENT execution attempt must NEVER reuse a clientOrderId that
//      might still be open — that would earn a REJECTED from Binance for a
//      reason that has nothing to do with the actual order, and TRUST must
//      not misread that as "my order was rejected by the market."
//
// Binance's docs (checked 2026-08-18) do not state an explicit
// character-set/length limit for newClientOrderId in the fetched excerpt —
// treated as REQUIRES VERIFICATION, not assumed. The format below is a
// conservative, deliberately narrow subset (lowercase hex + one literal
// hyphen, fixed 34 chars) chosen specifically so it cannot violate whatever
// the real constraint turns out to be, rather than pushing right up against
// an unverified limit.
const PREFIX = 't-'

export function newExecutionAttemptId(): string {
  return randomUUID()
}

// Deterministic: the SAME executionAttemptId always derives the SAME
// clientOrderId (property 2 in Step 4 — "deterministic for retries of the
// SAME execution attempt"). A DIFFERENT executionAttemptId (a fresh
// randomUUID()) always derives a different one (property "never reused for
// a different execution"). No secret material is used or embedded — the
// input is a random UUID with no relationship to any credential.
export function deriveClientOrderId(executionAttemptId: string): string {
  const hex = executionAttemptId.replace(/-/g, '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error('executionAttemptId must be a UUID (32 hex characters once hyphens are stripped).')
  }
  return `${PREFIX}${hex}`
}

export function isValidClientOrderId(value: string): boolean {
  return new RegExp(`^${PREFIX}[0-9a-f]{32}$`).test(value)
}
