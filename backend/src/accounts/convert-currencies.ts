// Part 32 — the fixed set of currencies Convert supports, and which real
// spot market (always USDT-quoted) each one is priced against. USDT itself
// is priced at exactly 1 (it IS the quote currency). Every other currency
// here has a real, already-configured MarketConfig row (see
// prisma/seed.ts's `markets` array) — this list is intentionally NOT "every
// currency the ledger has ever touched" (e.g. USD, XAU), only the crypto
// assets that actually have a USDT spot pair, so a rate can always be
// derived from a real live quote, never invented.
export const CONVERT_SYMBOL: Record<string, string | null> = {
  USDT: null,
  BTC: 'BTC/USDT',
  ETH: 'ETH/USDT',
  BNB: 'BNB/USDT',
  SOL: 'SOL/USDT',
  XRP: 'XRP/USDT',
  ADA: 'ADA/USDT',
  DOGE: 'DOGE/USDT',
}

export const CONVERTIBLE_CURRENCIES = Object.keys(CONVERT_SYMBOL)
