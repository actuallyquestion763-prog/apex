import { deriveClientOrderId, isValidClientOrderId, newExecutionAttemptId } from './client-order-id'

describe('client-order-id', () => {
  it('newExecutionAttemptId returns a fresh UUID each call', () => {
    const a = newExecutionAttemptId()
    const b = newExecutionAttemptId()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('deriveClientOrderId is deterministic: the SAME attempt id always derives the SAME clientOrderId', () => {
    const attemptId = newExecutionAttemptId()
    expect(deriveClientOrderId(attemptId)).toBe(deriveClientOrderId(attemptId))
  })

  it('deriveClientOrderId never reuses an id across two different attempts', () => {
    const a = deriveClientOrderId(newExecutionAttemptId())
    const b = deriveClientOrderId(newExecutionAttemptId())
    expect(a).not.toBe(b)
  })

  it('produces a safe, narrow charset (lowercase hex + one hyphen), well under any plausible provider length limit', () => {
    const id = deriveClientOrderId(newExecutionAttemptId())
    expect(id).toMatch(/^t-[0-9a-f]{32}$/)
    expect(id.length).toBeLessThanOrEqual(36)
  })

  it('rejects a malformed attempt id rather than silently producing a garbage clientOrderId', () => {
    expect(() => deriveClientOrderId('not-a-uuid')).toThrow()
    expect(() => deriveClientOrderId('')).toThrow()
  })

  it('isValidClientOrderId recognizes only well-formed derived ids', () => {
    const id = deriveClientOrderId(newExecutionAttemptId())
    expect(isValidClientOrderId(id)).toBe(true)
    expect(isValidClientOrderId('garbage')).toBe(false)
    expect(isValidClientOrderId('t-tooshort')).toBe(false)
  })
})
