import {
  PROTECTED_DEPOSIT_WALLETS,
  getProtectedDepositAddress,
  isDepositWalletProtectionActive,
  normalizeNetworkCode,
} from './protected-deposit-wallets'
import { validateReceivingAddress } from './address-validation.util'

// The five wallets exactly as specified — typed out independently of the
// module under test so a change to either side is caught.
const USDT_TRC20 = 'TY9jWFW7zPknZqT7T9x7SwiLLHfXNZXUpa'
const EVM = '0x4545e58dd75f65486fc9553277f76f178781bda2'
const BTC = '18chkuPvDEexJMmXXMtz7aExTL8FruU4jd'

describe('protected deposit wallets', () => {
  it('holds exactly the five specified wallets, byte for byte (no case change, truncation or normalization)', () => {
    const table = PROTECTED_DEPOSIT_WALLETS.map((w) => `${w.symbol}|${w.networkCodes[0]}|${w.address}`)
    expect(table).toEqual([
      `USDT|TRC20|${USDT_TRC20}`,
      `USDT|ERC20|${EVM}`,
      `BTC|BTC|${BTC}`,
      `ETH|ETH|${EVM}`,
      `BNB|BEP20|${EVM}`,
    ])
    expect(EVM).toBe(EVM.toLowerCase()) // the EVM address is intentionally all-lowercase, exactly as provided
  })

  it.each([
    ['USDT', 'TRC20', USDT_TRC20],
    ['USDT', 'ERC20', EVM],
    ['BTC', 'BTC', BTC],
    ['ETH', 'ETH', EVM],
    ['BNB', 'BEP20', EVM],
  ])('%s on %s resolves to its own protected address', (symbol, network, address) => {
    expect(getProtectedDepositAddress(symbol, network)).toBe(address)
  })

  it('the network is part of the wallet: USDT-TRC20 never gets the EVM address, USDT-ERC20 never gets the Tron address', () => {
    expect(getProtectedDepositAddress('USDT', 'TRC20')).not.toBe(getProtectedDepositAddress('USDT', 'ERC20'))
    expect(getProtectedDepositAddress('USDT', 'TRC20')).toBe(USDT_TRC20)
    expect(getProtectedDepositAddress('USDT', 'ERC20')).toBe(EVM)
  })

  it('is case-insensitive and ignores separators in the CMS network code (the CMS stores free text)', () => {
    expect(getProtectedDepositAddress('usdt', 'trc20')).toBe(USDT_TRC20)
    expect(getProtectedDepositAddress(' USDT ', ' Trc20 ')).toBe(USDT_TRC20)
    expect(getProtectedDepositAddress('BNB', 'BNB Smart Chain')).toBe(EVM)
    expect(getProtectedDepositAddress('BNB', 'bnb_smart-chain')).toBe(EVM)
    expect(getProtectedDepositAddress('BTC', 'Bitcoin')).toBe(BTC)
    expect(getProtectedDepositAddress('ETH', 'Ethereum')).toBe(EVM)
    expect(normalizeNetworkCode(' bnb  Smart_Chain ')).toBe('BNBSMARTCHAIN')
  })

  it('returns null — never a guess or the "nearest" wallet — for any pair without a protected wallet', () => {
    for (const [symbol, network] of [
      ['USDT', 'BEP20'], ['USDT', 'POLYGON'], ['USDT', 'BTC'], ['USDT', 'TRON'], ['USDT', ''],
      ['BTC', 'TRC20'], ['BTC', 'ERC20'], ['ETH', 'TRC20'], ['BNB', 'ERC20'], ['BNB', 'TRC20'],
      ['BNB', 'BNB'], // bare "BNB" is Beacon Chain, a different network from BNB Smart Chain
      ['SOL', 'SOL'], ['XRP', 'XRP'], ['LTC', 'LTC'], ['TRX', 'TRC20'], ['', 'TRC20'], ['USDC', 'ERC20'],
    ]) {
      expect({ symbol, network, address: getProtectedDepositAddress(symbol, network) }).toEqual({ symbol, network, address: null })
    }
  })

  it('every protected address is a real, format-valid address for its network under the same validator the CMS uses', () => {
    for (const w of PROTECTED_DEPOSIT_WALLETS) {
      for (const code of w.networkCodes) {
        // 'BSC'/'BNBSMARTCHAIN' aren't in the validator's own map (baseline
        // sanity applies) — the BEP20 alias covers the real EVM check.
        const result = validateReceivingAddress(code, w.address)
        expect({ symbol: w.symbol, code, valid: result.valid }).toEqual({ symbol: w.symbol, code, valid: true })
      }
    }
    expect(validateReceivingAddress('TRC20', USDT_TRC20).cryptographicallyVerified).toBe(true)
    expect(validateReceivingAddress('ERC20', EVM).cryptographicallyVerified).toBe(true)
    expect(validateReceivingAddress('BTC', BTC).cryptographicallyVerified).toBe(true)
  })

  it('is immutable at runtime — the table cannot be edited by other code', () => {
    expect(Object.isFrozen(PROTECTED_DEPOSIT_WALLETS)).toBe(true)
    for (const w of PROTECTED_DEPOSIT_WALLETS) {
      expect(Object.isFrozen(w)).toBe(true)
      expect(Object.isFrozen(w.networkCodes)).toBe(true)
      expect(() => { (w as { address: string }).address = 'attacker' }).toThrow(TypeError)
    }
    expect(() => { (PROTECTED_DEPOSIT_WALLETS as unknown as unknown[]).push({}) }).toThrow(TypeError)
    expect(getProtectedDepositAddress('BTC', 'BTC')).toBe(BTC)
  })

  describe('isDepositWalletProtectionActive — fails closed', () => {
    const original = process.env.NODE_ENV
    afterEach(() => {
      if (original === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = original
    })

    it.each([
      ['production', true],
      ['staging', true],
      ['PRODUCTION', true],
      ['prod', true],
      ['', true],
      ['development', false],
      ['test', false],
    ])('NODE_ENV=%j -> protection active: %s', (env, expected) => {
      process.env.NODE_ENV = env
      expect(isDepositWalletProtectionActive()).toBe(expected)
    })

    it('an UNSET NODE_ENV is protected (not treated as development)', () => {
      delete process.env.NODE_ENV
      expect(isDepositWalletProtectionActive()).toBe(true)
    })
  })
})
