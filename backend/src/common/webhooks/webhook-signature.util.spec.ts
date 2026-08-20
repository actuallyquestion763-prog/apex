import { createHmac } from 'crypto'
import { verifyHmacSignature, isTimestampFresh, WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS } from './webhook-signature.util'

describe('verifyHmacSignature', () => {
  const secret = 'test-webhook-secret'
  const body = JSON.stringify({ event: 'payment.confirmed', amount: '100.00' })
  const validSig = createHmac('sha256', secret).update(body).digest('hex')

  it('accepts a correctly signed payload', () => {
    expect(verifyHmacSignature(body, validSig, secret)).toBe(true)
  })

  it('rejects a tampered payload (signature no longer matches)', () => {
    const tampered = JSON.stringify({ event: 'payment.confirmed', amount: '999999.00' })
    expect(verifyHmacSignature(tampered, validSig, secret)).toBe(false)
  })

  it('rejects the right payload with the wrong secret', () => {
    const wrongSecretSig = createHmac('sha256', 'a-different-secret').update(body).digest('hex')
    expect(verifyHmacSignature(body, wrongSecretSig, secret)).toBe(false)
  })

  it('rejects a missing signature header', () => {
    expect(verifyHmacSignature(body, '', secret)).toBe(false)
  })

  it('rejects a malformed (non-hex, wrong-length) signature without throwing', () => {
    expect(verifyHmacSignature(body, 'not-a-real-signature', secret)).toBe(false)
  })
})

describe('isTimestampFresh', () => {
  const now = 1_700_000_000

  it('accepts a timestamp within tolerance', () => {
    expect(isTimestampFresh(now, now)).toBe(true)
    expect(isTimestampFresh(now - WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS, now)).toBe(true)
  })

  it('rejects a timestamp older than tolerance (replay of a captured request)', () => {
    expect(isTimestampFresh(now - WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS - 1, now)).toBe(false)
  })

  it('rejects a timestamp too far in the future', () => {
    expect(isTimestampFresh(now + WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS + 1, now)).toBe(false)
  })
})
