import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './auth'
import { api, ApiError } from '../lib/api'
import { loadNotifications, saveNotifications, uid } from './db'
import type {
  AccountSummary, LedgerEntry, Order, OrderSide, Position, Deposit, Withdrawal, Notification,
} from '../types'

// ---- Read hooks ----------------------------------------------------------
// Every one of these is a thin GET against the backend, gated on having a
// signed-in user. None of them cache across a page reload and none of them
// fall back to a stale value on error — `error` is surfaced to the caller
// instead so the UI can show a real error state.

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

export function useAccountSummary() {
  const { user } = useAuth()
  const { data, loading, error, refetch } = useResource<AccountSummary>(user ? '/accounts/me/summary' : null)
  return { summary: data, loading, error, refetch }
}

export function useLedgerHistory(limit = 100) {
  const { user } = useAuth()
  const { data, loading, error, refetch } = useResource<LedgerEntry[]>(user ? `/accounts/me/ledger?limit=${limit}` : null)
  return { entries: data ?? [], loading, error, refetch }
}

export function usePositions() {
  const { user } = useAuth()
  const { data, loading, error, refetch } = useResource<Position[]>(user ? '/positions/mine' : null)
  return { positions: data ?? [], loading, error, refetch }
}

export function useOrders() {
  const { user } = useAuth()
  const { data, loading, error, refetch } = useResource<Order[]>(user ? '/orders/mine' : null)
  return { orders: data ?? [], loading, error, refetch }
}

export function useDeposits() {
  const { user } = useAuth()
  const { data, loading, error, refetch } = useResource<Deposit[]>(user ? '/deposits/mine' : null)
  return { deposits: data ?? [], loading, error, refetch }
}

export function useWithdrawals() {
  const { user } = useAuth()
  const { data, loading, error, refetch } = useResource<Withdrawal[]>(user ? '/withdrawals/mine' : null)
  return { withdrawals: data ?? [], loading, error, refetch }
}

// ---- Write actions --------------------------------------------------------
// Every one of these is a direct backend call. None of them touch a local
// balance/position/transaction — the backend is the only thing that decides
// whether the action succeeded and what it did.

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

async function post<T>(path: string, body: unknown): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await api.post<T>(path, body) }
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Request failed.' }
  }
}

// Always results in an Order — this phase has no broker/exchange connected,
// so the order will come back REJECTED with an honest reason. It is never a
// Position; there is intentionally no client-side "fill" simulation.
export function submitOrder(params: { symbol: string; side: OrderSide; quantity: number }) {
  return post<Order>('/orders', { symbol: params.symbol, side: params.side, quantity: String(params.quantity) })
}

export function submitDeposit(params: { amount: number; method: string }) {
  return post<Deposit>('/deposits', { amount: String(params.amount), method: params.method })
}

export function submitWithdrawal(params: { amount: number; destination: string }) {
  return post<Withdrawal>('/withdrawals', { amount: String(params.amount), destination: params.destination })
}

export function submitKyc(providerReference?: string) {
  return post<{ id: string; status: string }>('/kyc/submit', providerReference ? { providerReference } : {})
}

// ---- Local, non-financial notifications -----------------------------------
// No backend model exists for these yet (foundation-phase gap) — they are
// UI convenience only and never gate or reflect financial/account state.

export function useNotifications() {
  const { user } = useAuth()
  const [all, setAll] = useState<Notification[]>(() => loadNotifications())

  useEffect(() => { setAll(loadNotifications()) }, [user?.id])

  const markNotificationsRead = useCallback((ids: string[]) => {
    setAll((prev) => {
      const next = prev.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n))
      saveNotifications(next)
      return next
    })
  }, [])

  const notifications = user ? all.filter((n) => n.userId === user.id) : []
  return { notifications, markNotificationsRead }
}

export function pushLocalNotification(userId: string, notif: { title: string; body: string; kind: Notification['kind'] }) {
  const notifications = loadNotifications()
  notifications.unshift({ id: uid(), userId, read: false, createdAt: Date.now(), ...notif })
  saveNotifications(notifications)
}

// ---- Derived helpers --------------------------------------------------------

// Cosmetic-only referral code derived from the account id. There is no
// backend referral system in this phase — this is display only, never sent
// anywhere or treated as a real credential.
export function cosmeticReferralCode(userId: string): string {
  return userId.replace(/-/g, '').slice(0, 8).toUpperCase()
}

// Unrealized P&L for one open position, using the server-provided
// currentPrice (mark-to-market) — never a client-side price feed. Positions
// with no currentPrice yet (not marked) contribute 0, not a fabricated value.
export function computePositionPnl(p: Position): number {
  if (!p.currentPrice) return 0
  const qty = Number(p.quantity)
  const entry = Number(p.avgEntryPrice)
  const mark = Number(p.currentPrice)
  if (!Number.isFinite(qty) || !Number.isFinite(entry) || !Number.isFinite(mark)) return 0
  const dir = p.side === 'BUY' ? 1 : -1
  return (mark - entry) * qty * dir
}
