// Wraps `multicoin-address-validator` (MIT, real cryptographic validation —
// base58/bech32 checksum for BTC, EIP-55 checksum for ETH-family addresses,
// etc.) rather than a homemade prefix/length regex (Part 10 explicitly
// warns against that). Maps TRUST's own networkCode values (as configured
// by an admin — see crypto-deposits.service.ts) to the library's currency
// symbols; EVM-compatible networks (ERC20, BEP20, POLYGON, ...) all share
// the same address FORMAT as Ethereum, so they validate against 'eth' —
// this is a format check, not a claim that the library knows about BEP20 or
// Polygon specifically.
import validator from 'multicoin-address-validator'

const NETWORK_TO_VALIDATOR_CURRENCY: Record<string, string> = {
  TRC20: 'trx',
  ERC20: 'eth',
  BEP20: 'eth',
  POLYGON: 'eth',
  ARBITRUM: 'eth',
  OPTIMISM: 'eth',
  AVALANCHE: 'eth',
  BTC: 'btc',
  BITCOIN: 'btc',
  ETH: 'eth',
  ETHEREUM: 'eth',
  BNB: 'bnb',
  SOL: 'sol',
  SOLANA: 'sol',
  XRP: 'xrp',
  RIPPLE: 'xrp',
  ADA: 'ada',
  CARDANO: 'ada',
  DOGE: 'doge',
  DOGECOIN: 'doge',
  TRX: 'trx',
  TRON: 'trx',
  LTC: 'ltc',
  LITECOIN: 'ltc',
}

// Baseline sanity check applied to EVERY address regardless of network
// (Part 10's other requirements — required, trimmed, reasonable length, no
// control characters) — enforced even for a network this module has no
// dedicated cryptographic validator for, so an unrecognized network never
// falls all the way through to "accept anything."
function passesBaselineSanity(address: string): boolean {
  if (address.length < 10 || address.length > 128) return false
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(address)) return false
  if (address !== address.trim()) return false
  return /^[a-zA-Z0-9:_-]+$/.test(address)
}

export interface AddressValidationResult {
  valid: boolean
  reason?: string
  // true when a real cryptographic validator (not just baseline sanity) was
  // used — surfaced so an admin UI/report can be honest about which
  // networks get genuine format verification vs. sanity-only checking.
  cryptographicallyVerified: boolean
}

export function validateReceivingAddress(networkCode: string, address: string): AddressValidationResult {
  const trimmed = address.trim()
  if (!trimmed) return { valid: false, reason: 'Receiving address is required.', cryptographicallyVerified: false }
  if (!passesBaselineSanity(trimmed)) {
    return { valid: false, reason: 'Address contains invalid characters or has an implausible length.', cryptographicallyVerified: false }
  }

  const currency = NETWORK_TO_VALIDATOR_CURRENCY[networkCode.toUpperCase()]
  if (!currency) {
    // No dedicated cryptographic validator for this admin-defined network —
    // never silently reject a network the admin explicitly configured just
    // because this module doesn't recognize it; baseline sanity already
    // passed above, so accept with cryptographicallyVerified: false rather
    // than guessing at a format.
    return { valid: true, cryptographicallyVerified: false }
  }

  let isValid: boolean
  try {
    isValid = validator.validate(trimmed, currency)
  } catch {
    // The library throws for a currency string it doesn't recognize at all
    // (shouldn't happen given the map above, but never let a third-party
    // library's exception become an unhandled 500).
    return { valid: true, cryptographicallyVerified: false }
  }

  if (!isValid) {
    return { valid: false, reason: `This does not look like a valid ${networkCode} address.`, cryptographicallyVerified: true }
  }
  return { valid: true, cryptographicallyVerified: true }
}
