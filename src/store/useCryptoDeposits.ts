// Crypto Deposit configuration + submission — a separate, minimal domain
// from useStore.ts's existing submitDeposit (Internal Transfer keeps using
// that, unchanged). Same thin-GET / real-POST pattern as every other store
// module in this app: the backend is the only source of truth for which
// assets/networks/addresses are currently offered — nothing here invents
// or caches a receiving address beyond what the backend just returned.
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './auth'
import { api, ApiError } from '../lib/api'
import type { Deposit } from '../types'

export interface CryptoNetworkConfig {
  networkCode: string
  networkName: string
  minimumDeposit: string | null
}

export interface CryptoAssetConfig {
  symbol: string
  name: string
  networks: CryptoNetworkConfig[]
}

export interface ResolvedCryptoAddress {
  symbol: string
  networkCode: string
  networkName: string
  receivingAddress: string
  minimumDeposit: string | null
}

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

export function useCryptoAssets() {
  const { user } = useAuth()
  const { data, loading, error, refetch } = useResource<CryptoAssetConfig[]>(user ? '/crypto-deposits/assets' : null)
  return { assets: data ?? [], loading, error, refetch }
}

// Resolves the CURRENT active receiving address for one (asset, network)
// pair, for display before submission (Part 13 steps 4-6). Re-fetched
// every time symbol/network changes — never cached across a selection
// change, so a mid-session admin address rotation is reflected immediately
// for anyone who re-selects (still re-validated again, independently, by
// the backend at actual submission time).
export function useResolvedCryptoAddress(symbol: string | null, networkCode: string | null) {
  const { user } = useAuth()
  const path = user && symbol && networkCode ? `/crypto-deposits/assets/${encodeURIComponent(symbol)}/networks/${encodeURIComponent(networkCode)}` : null
  const { data, loading, error, refetch } = useResource<ResolvedCryptoAddress>(path)
  return { resolved: data, loading, error, refetch }
}

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

export async function submitCryptoDeposit(params: {
  amount: string
  cryptoAssetSymbol: string
  networkCode: string
}): Promise<ActionResult<Deposit>> {
  try {
    return { ok: true, data: await api.post<Deposit>('/deposits', { method: 'CRYPTO', amount: params.amount, cryptoAssetSymbol: params.cryptoAssetSymbol, networkCode: params.networkCode }) }
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Request failed.' }
  }
}

export async function uploadDepositProof(depositId: string, file: File): Promise<ActionResult<Deposit>> {
  try {
    const form = new FormData()
    form.append('file', file)
    return { ok: true, data: await api.postForm<Deposit>(`/deposits/${depositId}/proof`, form) }
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Upload failed.' }
  }
}
