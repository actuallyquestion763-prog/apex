// Generic webhook verification primitives (Phase 5, Part 14) — a provider-
// agnostic foundation, NOT wired to any route or any real payment/execution
// provider. No provider is connected in this phase; this exists so that
// when one is, the security-critical parts (signature check, timestamp
// freshness, replay protection) already exist, are already tested, and
// don't get written under deadline pressure at integration time.
import { createHmac, timingSafeEqual } from 'crypto'

// HMAC-SHA256 over the RAW request body (never a re-serialized/parsed-then-
// re-stringified version of it — that can differ byte-for-byte from what
// the provider actually signed, e.g. due to key ordering or whitespace,
// silently breaking verification or worse, silently "fixing" a forged
// payload to look valid). Callers must capture the raw body themselves
// (e.g. via a raw-body-preserving body parser) before this is useful.
export function verifyHmacSignature(rawBody: string | Buffer, signatureHeader: string, secret: string): boolean {
  if (!signatureHeader) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  const givenBuf = Buffer.from(signatureHeader, 'hex')
  // timingSafeEqual throws on length mismatch rather than returning false —
  // treat that the same as "not equal", never let a length-based timing
  // signal (or an unhandled exception) leak anything about the secret.
  if (expectedBuf.length !== givenBuf.length) return false
  return timingSafeEqual(expectedBuf, givenBuf)
}

// A signed timestamp older/newer than this is rejected even with a valid
// signature — bounds how long a captured, genuinely-signed request stays
// replayable if an attacker recorded it off the wire. 5 minutes is a
// common default (Stripe, for comparison, uses 5 minutes) — a PROPOSED
// default, not a value any real provider integration has dictated yet.
export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300

export function isTimestampFresh(timestampSeconds: number, nowSeconds: number = Math.floor(Date.now() / 1000)): boolean {
  return Math.abs(nowSeconds - timestampSeconds) <= WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS
}
