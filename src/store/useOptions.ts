// Fixed-Time Options Trading — a separate product from spot (see useStore.ts
// for spot's own hooks). Same thin-GET / real-POST pattern: every read hook
// is a plain backend call, gated on a signed-in user; every write action
// goes straight to the backend and reports ok/error, never simulating a
// result client-side. The backend is the only source of truth for prices,
// results, and payouts (see backend/src/options/options.service.ts).
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './auth'
import { api, ApiError } from '../lib/api'
import type { OptionMarketConfig, OptionResultMode, OptionTrade } from '../types'

function useResource<T>(path: string | null): { data: T | null; loading: boolean; error: string | null; refetch: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    if (!path) { setData(null); setLoading(false); setError(null); return }
    setLoading(true)
    setError(null)
    try {
      setData(await api.get<T>(path))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => { refetch() }, [refetch])

  return { data, loading, error, refetch }
}

export function useOptionMarkets() {
  const { user } = useAuth()
  const { data, loading, error, refetch } = useResource<OptionMarketConfig[]>(user ? '/options/markets' : null)
  return { markets: data ?? [], loading, error, refetch }
}

// A market's own stake currency (e.g. USDT) may differ from the spot
// summary's USD balance — this is a currency-aware read, never assuming USD.
export function useOptionBalance(currency: string) {
  const { user } = useAuth()
  const { data, loading, error, refetch } = useResource<{ currency: string; cash: string; reserved: string }>(user ? `/options/balance?currency=${encodeURIComponent(currency)}` : null)
  return { balance: data, loading, error, refetch }
}

// Polled rather than a one-shot fetch — an active trade's remaining time is
// display-only client math (Date vs the authoritative expiryAt), but the
// STATUS itself (does it still exist, has it settled) needs to reflect
// backend state without requiring a manual page reload once it expires.
const ACTIVE_TRADES_POLL_MS = 3_000

export function useActiveOptionTrades() {
  const { user } = useAuth()
  const [trades, setTrades] = useState<OptionTrade[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    if (!user) { setTrades([]); setLoading(false); return }
    try {
      setTrades(await api.get<OptionTrade[]>('/options/trades/active'))
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    refetch()
    if (!user) return
    const id = setInterval(refetch, ACTIVE_TRADES_POLL_MS)
    return () => clearInterval(id)
  }, [user, refetch])

  return { trades, loading, error, refetch }
}

export interface OptionTradeHistoryFilters {
  symbol?: string
  result?: 'WIN' | 'LOSS' | 'DRAW'
  active?: boolean
  completed?: boolean
  from?: string
  to?: string
}

export function useOptionTradeHistory(filters: OptionTradeHistoryFilters = {}) {
  const { user } = useAuth()
  const params = new URLSearchParams()
  if (filters.symbol) params.set('symbol', filters.symbol)
  if (filters.result) params.set('result', filters.result)
  if (filters.active) params.set('active', 'true')
  if (filters.completed) params.set('completed', 'true')
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  const qs = params.toString()
  const path = user ? `/options/trades/mine${qs ? `?${qs}` : ''}` : null
  const { data, loading, error, refetch } = useResource<OptionTrade[]>(path)
  return { trades: data ?? [], loading, error, refetch }
}

export function useOptionTrade(id: string | null) {
  const { user } = useAuth()
  const { data, loading, error, refetch } = useResource<OptionTrade>(user && id ? `/options/trades/${id}` : null)
  return { trade: data, loading, error, refetch }
}

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number }

export async function submitOptionTrade(params: {
  symbol: string
  direction: 'BUY' | 'SELL'
  investment: string
  durationSeconds: number
  requestedResultMode?: OptionResultMode
}): Promise<ActionResult<OptionTrade>> {
  try {
    return { ok: true, data: await api.post<OptionTrade>('/options/trades', params) }
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: e.message, status: e.status }
    return { ok: false, error: 'Request failed.', status: 0 }
  }
}
