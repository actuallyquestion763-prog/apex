import { validateReceivingAddress } from './address-validation.util'

// Genuinely random, 20-byte-derived addresses — guaranteed correct length
// (0x + 40 hex chars) so a passing/failing test reflects the validator's
// real behavior, not a hand-typed fixture with the wrong character count.
const LOWERCASE_ETH_ADDRESS = '0x028693214afa4e3bf4537175b5505315afda80a3'
const CHECKSUMMED_ETH_ADDRESS = '0x028693214AFA4E3bf4537175b5505315AFda80A3' // same address, EIP-55 checksummed

describe('validateReceivingAddress', () => {
  it('accepts a real, checksummed ETH/ERC20 address', () => {
    const result = validateReceivingAddress('ERC20', CHECKSUMMED_ETH_ADDRESS)
    expect(result.valid).toBe(true)
    expect(result.cryptographicallyVerified).toBe(true)
  })

  it('accepts the same address format for BEP20 (EVM-compatible)', () => {
    const result = validateReceivingAddress('BEP20', CHECKSUMMED_ETH_ADDRESS)
    expect(result.valid).toBe(true)
  })

  it('accepts an all-lowercase ETH address (unambiguous, no checksum claimed)', () => {
    const result = validateReceivingAddress('ERC20', LOWERCASE_ETH_ADDRESS)
    expect(result.valid).toBe(true)
  })

  it('rejects an ETH address with a broken mixed-case checksum', () => {
    // Corrupt exactly one letter's case in the checksummed address — this
    // specific address/position is verified (via this same library) to
    // break EIP-55 validation, not merely "differently cased."
    const corrupted = '0x028693214afA4E3bf4537175b5505315AFda80A3'
    expect(corrupted).not.toBe(CHECKSUMMED_ETH_ADDRESS)
    const result = validateReceivingAddress('ERC20', corrupted)
    expect(result.valid).toBe(false)
  })

  it('accepts a real, valid BTC bech32 address', () => {
    const result = validateReceivingAddress('BTC', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')
    expect(result.valid).toBe(true)
    expect(result.cryptographicallyVerified).toBe(true)
  })

  it('rejects an obviously malformed BTC address', () => {
    const result = validateReceivingAddress('BTC', 'not-a-real-bitcoin-address')
    expect(result.valid).toBe(false)
  })

  it('rejects an empty or whitespace-only address', () => {
    expect(validateReceivingAddress('BTC', '').valid).toBe(false)
    expect(validateReceivingAddress('BTC', '   ').valid).toBe(false)
  })

  it('rejects an address containing control characters', () => {
    const result = validateReceivingAddress('TRC20', 'TJX9aKp7m3\x00QrVb8sN2cWdFzL4hY6tRxEuP')
    expect(result.valid).toBe(false)
  })

  it('rejects an address with leading/trailing whitespace as-is (caller should trim before storing, this signals it was not pre-trimmed)', () => {
    const result = validateReceivingAddress('TRC20', ' TJX9aKp7m3QrVb8sN2cWdFzL4hY6tRxEuP ')
    expect(result.valid).toBe(false)
  })

  it('does not reject a plausible address on an admin-defined network with no dedicated cryptographic validator, but marks it as not cryptographically verified', () => {
    const result = validateReceivingAddress('SOMENEWCHAIN', 'a-plausible-looking-address-1234567890')
    expect(result.valid).toBe(true)
    expect(result.cryptographicallyVerified).toBe(false)
  })

  it('still rejects an implausibly short or long value even for an unrecognized network', () => {
    expect(validateReceivingAddress('SOMENEWCHAIN', 'x').valid).toBe(false)
    expect(validateReceivingAddress('SOMENEWCHAIN', 'x'.repeat(200)).valid).toBe(false)
  })
})
