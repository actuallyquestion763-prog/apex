// PROTECTED PRODUCTION DEPOSIT WALLETS — a deliberately hard-coded,
// temporary protection layer.
//
// The CMS/admin "Deposit Wallet" screen stays fully editable (it still stores,
// audits and displays whatever an admin types into CryptoDepositAddress), but
// that CMS value is NOT trusted as the address a CUSTOMER deposits to. In
// production the customer-facing flow takes the address from THIS file
// instead, so a compromised admin session cannot redirect deposits by editing
// a wallet address in the CMS. The single place that enforces this is
// CryptoDepositsService.resolveForDeposit() (see crypto-deposits.service.ts),
// which both the address-display endpoint and deposit creation go through.
//
// The addresses are public deposit addresses, not secrets. They live in
// source on purpose: anything editable at runtime (database row, env var,
// admin setting) would be exactly the thing an attacker with admin access can
// change. This intentionally reverses the seed script's earlier "no receiving
// address in source" rule for these five wallets only — changing one now needs
// a code change and a deploy.
//
// The NETWORK is part of each wallet's identity: an address is only ever
// returned for the (asset, network) pair it was defined for. TRC20 and ERC20
// USDT are different wallets; the 0x address is repeated below only because it
// is genuinely the same EVM account used for USDT-ERC20, ETH and BNB Smart
// Chain, and each entry names its network explicitly.
//
// Do NOT normalize, truncate or re-case any address below (the EVM ones are
// intentionally lowercase, exactly as provided).

export interface ProtectedDepositWallet {
  readonly symbol: string
  // Accepted CMS networkCode spellings for this wallet, compared after
  // normalizeNetworkCode(). Kept tight on purpose: a code not listed here
  // gets NO address, never a "closest match".
  readonly networkCodes: readonly string[]
  readonly address: string
}

const WALLETS: readonly ProtectedDepositWallet[] = [
  { symbol: 'USDT', networkCodes: ['TRC20'], address: 'TY9jWFW7zPknZqT7T9x7SwiLLHfXNZXUpa' },
  { symbol: 'USDT', networkCodes: ['ERC20'], address: '0x4545e58dd75f65486fc9553277f76f178781bda2' },
  { symbol: 'BTC', networkCodes: ['BTC', 'BITCOIN'], address: '18chkuPvDEexJMmXXMtz7aExTL8FruU4jd' },
  { symbol: 'ETH', networkCodes: ['ETH', 'ETHEREUM', 'ERC20'], address: '0x4545e58dd75f65486fc9553277f76f178781bda2' },
  // BNB Smart Chain (BEP20). Deliberately NOT keyed by the bare code "BNB":
  // that is BNB Beacon Chain, a different network with a different address
  // format, and must never be handed this EVM address.
  { symbol: 'BNB', networkCodes: ['BEP20', 'BSC', 'BNBSMARTCHAIN'], address: '0x4545e58dd75f65486fc9553277f76f178781bda2' },
]

export const PROTECTED_DEPOSIT_WALLETS: readonly ProtectedDepositWallet[] = Object.freeze(
  WALLETS.map((w) => Object.freeze({ ...w, networkCodes: Object.freeze([...w.networkCodes]) })),
)

export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase()
}

// Case-insensitive and ignores separators, so "bep20", "BNB Smart Chain" and
// "BNB_SMART_CHAIN" all mean the same network.
export function normalizeNetworkCode(networkCode: string): string {
  return networkCode.trim().toUpperCase().replace(/[\s_-]+/g, '')
}

// The protected address for one (asset, network), or null when this pair has
// no protected wallet (callers must treat null as "not available", never fall
// back to the CMS value).
export function getProtectedDepositAddress(symbol: string, networkCode: string): string | null {
  const sym = normalizeSymbol(symbol)
  const net = normalizeNetworkCode(networkCode)
  const wallet = PROTECTED_DEPOSIT_WALLETS.find((w) => w.symbol === sym && w.networkCodes.includes(net))
  return wallet ? wallet.address : null
}

// Protection is ON unless NODE_ENV is explicitly 'development' or 'test' — so
// production, staging, and any unset/unrecognized value are all protected
// (fail closed). The environment is not database-driven, not a request
// field and not an admin toggle: nothing reachable through the CMS can turn
// it off. Development/test keep serving the CMS value so local work and the
// automated suite (which uses throwaway assets and addresses) are unchanged.
export function isDepositWalletProtectionActive(): boolean {
  const env = process.env.NODE_ENV
  return env !== 'development' && env !== 'test'
}
