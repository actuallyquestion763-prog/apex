// Currency conversion (Part 32) — thin POST wrapper, same pattern as every
// other financial-action function in this codebase (submitOrder,
// submitOptionTrade, submitCryptoDeposit): the backend is the only source
// of truth for the actual rate/amounts; this never computes or fabricates
// a result client-side, only reports what the backend returns.
import { api, ApiError } from '../lib/api'

// Every currency Convert supports, matching backend/src/accounts/convert-currencies.ts
// exactly — kept in sync manually since this is a small, fixed list, not
// worth a network round-trip just to fetch a static array.
export const CONVERTIBLE_CURRENCIES = ['USDT', 'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE']

export interface ConvertResult {
  transactionId: string
  fromCurrency: string
  toCurrency: string
  fromAmount: string
  toAmount: string
}

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

export async function submitConvert(params: { fromCurrency: string; toCurrency: string; amount: string }): Promise<ActionResult<ConvertResult>> {
  try {
    return { ok: true, data: await api.post<ConvertResult>('/accounts/me/convert', params) }
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Request failed.' }
  }
}
