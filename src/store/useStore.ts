import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './auth'
import { api, ApiError } from '../lib/api'
import { loadNotifications, saveNotifications, uid } from './db'
import type {
  AccountSummary, AssetBalance, CashBalance, LedgerEntry, MarketConfig, Order, OrderSide, Position, Deposit, Withdrawal, Notification,
  ExecutionStatus,
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

// Currency-specific cash balance (Trade Experience checkpoint, Part 1) —
// the Trade page uses this instead of the USD-only summary above so a
// BTC/USDT order shows real USDT availability, never a generic "$" figure.
// Backend remains authoritative: this is a thin GET, no frontend arithmetic.
export function useCashBalance(currency: string | null) {
  const { user } = useAuth()
  const path = user && currency ? `/accounts/me/balance?currency=${encodeURIComponent(currency)}` : null
  const { data, loading, error, refetch } = useResource<CashBalance>(path)
  return { balance: data, loading, error, refetch }
}

// Spot Holdings Visibility checkpoint — every currency the user actually
// holds a non-zero balance in, straight from the ledger. No price, no
// unrealized P&L — the backend never computes either for this endpoint.
export function useAssetBalances() {
  const { user } = useAuth()
  const { data, loading, error, refetch } = useResource<AssetBalance[]>(user ? '/accounts/me/assets' : null)
  return { assets: data ?? [], loading, error, refetch }
}

// Real, backend-configured market list (Part 1) — quoteAsset/baseAsset come
// from here, never hardcoded in a component. GET /markets has no auth guard
// on the backend (MarketsController) and is genuinely public, so this fetch
// is never gated behind a signed-in user — PriceTicker/MarketOverview render
// on the logged-out landing page too, and need the real quoteAsset there
// just as much as anywhere else (Phase F currency audit: gating this behind
// `user` silently made every price on the public landing page fall back to
// a hardcoded "USD", including USDT-quoted pairs).
export function useMarketConfigs() {
  const { data, loading, error, refetch } = useResource<MarketConfig[]>('/markets')
  return { markets: data ?? [], loading, error, refetch }
}

// Which ExecutionProvider is actually active (Part 5) — drives the Trade
// page's environment-aware disclaimer instead of a hardcoded claim.
export function useExecutionStatus() {
  const { user } = useAuth()
  const { data, loading, error } = useResource<ExecutionStatus>(user ? '/execution/status' : null)
  return { status: data, loading, error }
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

export function submitWithdrawal(params: { amount: number; destination: string; currency: string }) {
  return post<Withdrawal>('/withdrawals', { amount: String(params.amount), destination: params.destination, currency: params.currency })
}

// ---- Notifications -----------------------------------------------------------
// Two sources, merged for display: local/UI-only notifications (price
// alerts etc. — still no backend model, still never authoritative for
// money/identity) and real, server-backed SupportNotification rows (Phase
// 4 — see backend/src/support/support.service.ts's notify()). The support
// half is polled on an interval rather than only refetched on navigation
// (the Phase 3.1-identified gap) — full push/WebSocket delivery was
// deliberately not built for this (see Part 17 of the Phase 4 spec:
// real-time infrastructure wasn't judged worth the complexity here;
// polling is a documented, reasonable middle ground).
const SUPPORT_POLL_MS = 30_000

interface SupportNotificationRow {
  id: string; ticketId: string; event: string; message: string; readAt: string | null; createdAt: string
}

export function useNotifications() {
  const { user } = useAuth()
  const [all, setAll] = useState<Notification[]>(() => loadNotifications())
  const [supportRows, setSupportRows] = useState<SupportNotificationRow[]>([])

  useEffect(() => { setAll(loadNotifications()) }, [user?.id])

  const refetchSupport = useCallback(async () => {
    if (!user) { setSupportRows([]); return }
    try {
      setSupportRows(await api.get<SupportNotificationRow[]>('/support/notifications'))
    } catch {
      // Silent — notifications are a convenience surface, not something
      // that should show an error banner if the poll transiently fails.
    }
  }, [user])

  useEffect(() => {
    refetchSupport()
    if (!user) return
    const id = setInterval(refetchSupport, SUPPORT_POLL_MS)
    return () => clearInterval(id)
  }, [user, refetchSupport])

  const markNotificationsRead = useCallback(async (ids: string[]) => {
    setAll((prev) => {
      const next = prev.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n))
      saveNotifications(next)
      return next
    })
    const supportIds = supportRows.filter((r) => ids.includes(r.id)).map((r) => r.id)
    if (supportIds.length > 0) {
      setSupportRows((prev) => prev.map((r) => (supportIds.includes(r.id) ? { ...r, readAt: new Date().toISOString() } : r)))
      try { await api.patch('/support/notifications/read', { ids: supportIds }) } catch { /* best-effort; next poll reconciles */ }
    }
  }, [supportRows])

  const localForUser = user ? all.filter((n) => n.userId === user.id) : []
  const supportAsNotifications: Notification[] = supportRows.map((r) => ({
    id: r.id, userId: user?.id ?? '', title: supportEventTitle(r.event), body: r.message,
    read: r.readAt !== null, createdAt: Date.parse(r.createdAt), kind: 'support',
  }))
  const notifications = [...supportAsNotifications, ...localForUser].sort((a, b) => b.createdAt - a.createdAt)

  return { notifications, markNotificationsRead }
}

function supportEventTitle(event: string): string {
  const labels: Record<string, string> = {
    AGENT_REPLIED: 'Support replied', CUSTOMER_REPLIED: 'Customer replied', TICKET_ASSIGNED: 'Ticket assigned',
    STATUS_CHANGED: 'Ticket updated', TICKET_RESOLVED: 'Ticket resolved', TICKET_REOPENED: 'Ticket reopened',
  }
  return labels[event] ?? 'Support update'
}

export function pushLocalNotification(userId: string, notif: { title: string; body: string; kind: Notification['kind'] }) {
  const notifications = loadNotifications()
  notifications.unshift({ id: uid(), userId, read: false, createdAt: Date.now(), ...notif })
  saveNotifications(notifications)
}

// ---- Derived helpers --------------------------------------------------------

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
