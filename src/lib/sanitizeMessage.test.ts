import { describe, it, expect } from 'vitest'
import { stripInternalCodePrefix } from './sanitizeMessage'

describe('stripInternalCodePrefix — never show internal backend error codes to users', () => {
  it('strips a leading ALL_CAPS_CODE: prefix', () => {
    expect(stripInternalCodePrefix('RISK_CONFIGURATION_ERROR: No trusted price is available to evaluate this order.'))
      .toBe('No trusted price is available to evaluate this order.')
  })

  it('strips a different code prefix the same way', () => {
    expect(stripInternalCodePrefix('INSUFFICIENT_BALANCE: Your available balance is too low for this order.'))
      .toBe('Your available balance is too low for this order.')
  })

  it('leaves an ordinary message with no code prefix unchanged', () => {
    expect(stripInternalCodePrefix('Order was rejected.')).toBe('Order was rejected.')
  })

  it('does not strip a legitimate leading word followed by a colon', () => {
    expect(stripInternalCodePrefix('Note: this order was partially filled.')).toBe('Note: this order was partially filled.')
  })

  it('does not strip a colon that appears mid-message', () => {
    expect(stripInternalCodePrefix('Order rejected: insufficient margin for this position.'))
      .toBe('Order rejected: insufficient margin for this position.')
  })

  it('passes through the fallback "Order was rejected." message unchanged', () => {
    expect(stripInternalCodePrefix('Order was rejected.')).toBe('Order was rejected.')
  })
})
