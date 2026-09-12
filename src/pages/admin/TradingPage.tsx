// Trade Management — kill switch, risk limits, live trade data (current +
// historical), unresolved-trade handling, and asset/duration/payout
// configuration for the options-trading product. Ported from the old
// AdminPage.tsx OptionsTab/NumberSetting/OptionMarketRow/DurationRow.
//
// IMPORTANT — outcome-manipulation constraint: this page must NEVER expose
// any control that lets an admin force a REAL customer's trade to win or
// lose, in production or otherwise. Three mechanisms exist, all
// development/test-only (see backend/src/options/sandbox-env.ts +
// isDemoResultModeAllowed(), re-checked independently at settlement time
// regardless of what any row currently holds):
//   1. OptionsSettings.sandboxOutcomeMode — platform-wide (ALL USER
//      CONTROL below).
//   2. OptionTrade.requestedResultMode — per-trade, chosen by whoever
//      creates the trade.
//   3. User.testOutcomeMode — per-user (USER CONTROL below), but ONLY ever
//      consulted for a user with User.isTestUser = true. isTestUser can
//      NEVER be set on an existing account — the only code path that sets
//      it (OptionsService.createTestUser) always creates a brand-new
//      account. So there is no way, from this UI or any endpoint, for an
//      admin to convert an arbitrary real customer into a "test user" and
//      force their outcomes — see schema.prisma's User.isTestUser doc
//      comment and options.service.ts's settleTrade()/
//      setTestUserOutcomeMode().
import { useState } from 'react'
import { ArrowLeft, FlaskConical, Plus, RefreshCw, Search, UserPlus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { StepUpModal } from '../../components/StepUpModal'
import type { OptionMarketAdminRow, OptionsSettings as OptionsSettingsType, OptionsStats, OptionTrade } from '../../types'
import { AdminPanel, AdminStat, AdminTable, AdminTableHead, AdminStatusBadge, statusTone, useAdmin, tryAction } from '../../components/admin'

type TestOutcomeMode = 'NORMAL' | 'FORCE_WIN' | 'FORCE_LOSS'

interface AdminOptionTrade extends OptionTrade { user: { id: string; email: string; fullName: string } }
interface AdminUserRow { id: string; email: string; fullName: string; usdtBalance: string; isTestUser: boolean; testOutcomeMode: TestOutcomeMode }

type StepUpAction =
  | { kind: 'settings'; patch: Record<string, unknown> }
  | { kind: 'createTestUser'; email: string; fullName: string; password: string }
  | { kind: 'testUserOutcome'; userId: string; testOutcomeMode: TestOutcomeMode }

// Status badge tone, scoped to this page only — an ACTIVE trade is still in
// progress (not a win), so it gets the neutral/blue "in progress" treatment
// instead of the shared statusTone's success/green (which elsewhere means
// "confirmed good", e.g. an active user account). Everything else — WIN,
// LOSS, PENDING (mapped from UNRESOLVED below) — already gets the right
// color from the shared statusTone, so this only overrides ACTIVE.
function tradeStatusTone(status: string) {
  if (status === 'ACTIVE') return 'info' as const
  return statusTone(status)
}

export function TradingPage() {
  const { push } = useToast()
  const settingsRes = useAdmin<OptionsSettingsType>('/admin/options/settings')
  const marketsRes = useAdmin<OptionMarketAdminRow[]>('/admin/options/markets')
  const statsRes = useAdmin<OptionsStats>('/admin/options/stats')
  const unresolvedRes = useAdmin<{ count: number; trades: any[] }>('/admin/options/unresolved')
  const [stepUp, setStepUp] = useState<StepUpAction | null>(null)
  const [newSymbol, setNewSymbol] = useState('')
  const [sweeping, setSweeping] = useState(false)

  // USER CONTROL — search + select a real user (backed by the existing
  // /admin/users search endpoint), which both filters Current Trading/Trade
  // List to that user's rows AND, if the selected user is a designated
  // test/sandbox user, exposes TEST USER WIN/LOSE/NORMAL for them.
  const [userQuery, setUserQuery] = useState('')
  const [userResults, setUserResults] = useState<AdminUserRow[] | null>(null)
  const [searchingUsers, setSearchingUsers] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState('')

  // "Create Test User" — the only way isTestUser ever becomes true; always
  // a brand-new account, never an existing one.
  const [newTestUserEmail, setNewTestUserEmail] = useState('')
  const [newTestUserFullName, setNewTestUserFullName] = useState('')
  const [newTestUserPassword, setNewTestUserPassword] = useState('')

  async function searchUsers(q: string) {
    setSearchingUsers(true)
    const res = await tryAction(() => api.get<AdminUserRow[]>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`))
    setSearchingUsers(false)
    if (res.ok) setUserResults(res.data)
    else push('error', res.error)
  }

  const selectedUser = userResults?.find((u) => u.id === selectedUserId) ?? null

  function requestCreateTestUser() {
    if (!newTestUserEmail.trim() || !newTestUserPassword.trim()) return
    setStepUp({ kind: 'createTestUser', email: newTestUserEmail.trim(), fullName: newTestUserFullName.trim(), password: newTestUserPassword })
  }

  // Real, individual, cross-customer trades — "Current Trading" (ACTIVE) and
  // "Trade List" (everything, most recent 100) both hit the same read-only
  // admin endpoint (GET /admin/options/trades), with an optional status
  // filter and an optional userId filter (USER CONTROL, above). No mock/
  // fabricated rows anywhere.
  const userFilter = selectedUserId ? `&userId=${encodeURIComponent(selectedUserId)}` : ''
  const activeTradesRes = useAdmin<AdminOptionTrade[]>(`/admin/options/trades?status=ACTIVE${userFilter}`)
  const allTradesRes = useAdmin<AdminOptionTrade[]>(`/admin/options/trades?${selectedUserId ? `userId=${encodeURIComponent(selectedUserId)}` : ''}`)

  async function createMarket() {
    if (!newSymbol.trim()) return
    const res = await tryAction(() => api.post('/admin/options/markets', { symbol: newSymbol.trim() }))
    if (res.ok) { push('success', `${newSymbol} added.`); setNewSymbol(''); marketsRes.refetch() }
    else push('error', res.error)
  }

  async function toggleMarket(symbol: string, enabled: boolean) {
    const res = await tryAction(() => api.patch(`/admin/options/markets/${encodeURIComponent(symbol)}`, { enabled }))
    if (res.ok) { push('success', `${symbol} ${enabled ? 'enabled' : 'disabled'}.`); marketsRes.refetch() }
    else push('error', res.error)
  }

  async function upsertDuration(symbol: string, durationSeconds: number, payoutPercent: string, enabled: boolean, minAmount?: string) {
    const res = await tryAction(() => api.patch(`/admin/options/markets/${encodeURIComponent(symbol)}/durations`, { durationSeconds, payoutPercent, enabled, ...(minAmount !== undefined ? { minAmount } : {}) }))
    if (res.ok) { push('success', `${symbol} ${durationSeconds}s updated.`); marketsRes.refetch() }
    else push('error', res.error)
  }

  // Existing on-demand retry sweep — never fabricates a result, only
  // retries the same real settlement path the automatic 2s sweep uses.
  async function retrySweep() {
    setSweeping(true)
    const res = await tryAction(() => api.post('/admin/options/sweep'))
    setSweeping(false)
    if (res.ok) { push('success', 'Retry sweep completed.'); unresolvedRes.refetch(); activeTradesRes.refetch(); allTradesRes.refetch(); statsRes.refetch() }
    else push('error', res.error)
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <Link to="/admin" className="inline-flex items-center gap-1.5 rounded-lg bg-admin-gold px-3 py-1.5 text-xs font-semibold text-admin-bg2 transition hover:bg-admin-goldLight">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>
        <h1 className="text-base font-bold text-admin-text">Trade Management</h1>
      </div>

      <div className="space-y-3">
        {/* ALL USER CONTROL — the existing sandboxOutcomeMode dial, and
            nothing else. Only rendered when the backend itself reports
            sandboxControlsAvailable (development/test only); real customer
            trades in production are never reachable by this. */}
        {settingsRes.data?.sandboxControlsAvailable && (
          <div className="admin-card border-bear/30 p-3">
            <div className="flex items-center gap-1.5">
              <FlaskConical className="h-3.5 w-3.5 text-bear" />
              <h3 className="text-xs font-bold uppercase tracking-wide text-bear">All User Control — Test/Simulation Only</h3>
            </div>
            <p className="mt-1 text-[10px] text-admin-mutedDim">Platform-wide, this environment only. Never affects real Binance execution or production. Every change is audit logged.</p>
            <div className="mt-2.5 flex gap-2.5">
              <button
                onClick={() => setStepUp({ kind: 'settings', patch: { sandboxOutcomeMode: 'FORCE_WIN' } })}
                className={`flex-1 rounded-lg px-4 py-2 text-xs font-bold ${settingsRes.data.sandboxOutcomeMode === 'FORCE_WIN' ? 'bg-bull text-white' : 'border border-bull/30 text-bull hover:bg-bull/10'}`}
              >
                WIN ALL
              </button>
              <button
                onClick={() => setStepUp({ kind: 'settings', patch: { sandboxOutcomeMode: 'FORCE_LOSS' } })}
                className={`flex-1 rounded-lg px-4 py-2 text-xs font-bold ${settingsRes.data.sandboxOutcomeMode === 'FORCE_LOSS' ? 'bg-bear text-white' : 'border border-bear/30 text-bear hover:bg-bear/10'}`}
              >
                LOSE ALL
              </button>
              <button
                onClick={() => setStepUp({ kind: 'settings', patch: { sandboxOutcomeMode: 'RANDOM' } })}
                className={`rounded-lg px-3 py-2 text-xs font-bold ${settingsRes.data.sandboxOutcomeMode === 'RANDOM' ? 'border border-admin-borderLight bg-admin-surface text-admin-text' : 'border border-admin-border text-admin-mutedDim hover:text-admin-text'}`}
              >
                NORMAL
              </button>
            </div>
          </div>
        )}

        {/* USER CONTROL — a real per-user trade filter (search real users,
            select one, Current Trading/Trade List narrow to their rows),
            plus per-user WIN/LOSE — but that outcome control is only ever
            functional for a user with isTestUser=true (enforced server-side
            in setTestUserOutcomeMode, not just in this disabled state). For
            every other selected user the buttons render disabled with an
            explanation — there is no way to force a real customer's trade. */}
        <div className="admin-card p-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-admin-gold">User Control</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-admin-mutedDim" />
              <input
                className="w-full rounded-lg border border-admin-border bg-admin-bg2 py-1.5 pl-7 pr-3 text-xs text-admin-text placeholder-admin-mutedDim outline-none transition focus:border-ocean-500/60 focus:ring-1 focus:ring-ocean-500/20"
                placeholder="Search UID / Name…"
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchUsers(userQuery.trim())}
              />
            </div>
            <button onClick={() => searchUsers(userQuery.trim())} disabled={searchingUsers} className="admin-btn-info px-3 py-1.5 text-xs">{searchingUsers ? 'Searching…' : 'Search'}</button>
            <select
              className="min-w-[180px] flex-1 rounded-lg border border-admin-border bg-admin-bg2 px-3 py-1.5 text-xs text-admin-text outline-none transition focus:border-ocean-500/60 focus:ring-1 focus:ring-ocean-500/20"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
            >
              <option value="">{userResults ? 'Select User' : 'Search to select a user'}</option>
              {(userResults ?? []).map((u) => <option key={u.id} value={u.id}>{u.isTestUser ? '🧪 ' : ''}{u.fullName} — {u.email}</option>)}
            </select>
            {selectedUserId && <button onClick={() => setSelectedUserId('')} className="admin-btn-info px-3 py-1.5 text-xs">Clear</button>}
          </div>

          {/* USER WIN / USER LOSE — real, backend-persisted per-user outcome
              control, only ever shown at all in the same dev/test
              environment ALL USER CONTROL is gated on, and only ever
              functional for a designated test/sandbox user. */}
          {settingsRes.data?.sandboxControlsAvailable && (
            selectedUserId && selectedUser ? (
              selectedUser.isTestUser ? (
                <div className="mt-2.5 flex gap-2.5">
                  <button
                    onClick={() => setStepUp({ kind: 'testUserOutcome', userId: selectedUser.id, testOutcomeMode: 'FORCE_WIN' })}
                    className={`flex-1 rounded-lg px-4 py-2 text-xs font-bold ${selectedUser.testOutcomeMode === 'FORCE_WIN' ? 'bg-bull text-white' : 'border border-bull/30 text-bull hover:bg-bull/10'}`}
                  >
                    USER WIN
                  </button>
                  <button
                    onClick={() => setStepUp({ kind: 'testUserOutcome', userId: selectedUser.id, testOutcomeMode: 'FORCE_LOSS' })}
                    className={`flex-1 rounded-lg px-4 py-2 text-xs font-bold ${selectedUser.testOutcomeMode === 'FORCE_LOSS' ? 'bg-bear text-white' : 'border border-bear/30 text-bear hover:bg-bear/10'}`}
                  >
                    USER LOSE
                  </button>
                  <button
                    onClick={() => setStepUp({ kind: 'testUserOutcome', userId: selectedUser.id, testOutcomeMode: 'NORMAL' })}
                    className={`rounded-lg px-3 py-2 text-xs font-bold ${selectedUser.testOutcomeMode === 'NORMAL' ? 'border border-admin-borderLight bg-admin-surface text-admin-text' : 'border border-admin-border text-admin-mutedDim hover:text-admin-text'}`}
                  >
                    NORMAL
                  </button>
                </div>
              ) : (
                <div className="mt-2.5">
                  <div className="flex gap-2.5 opacity-40" title="Unavailable — this is not a designated test/sandbox user">
                    <button disabled className="admin-btn-success flex-1 px-4 py-2 text-xs">USER WIN</button>
                    <button disabled className="admin-btn-danger flex-1 px-4 py-2 text-xs">USER LOSE</button>
                    <button disabled className="admin-btn-secondary px-3 py-2 text-xs">NORMAL</button>
                  </div>
                  <p className="mt-1.5 text-[10px] text-admin-mutedDim">Not a designated test/sandbox user — outcome controls unavailable. A real customer's account can never be converted into one.</p>
                </div>
              )
            ) : (
              <div className="mt-2.5">
                <div className="flex gap-2.5 opacity-40" title="Select a user above first">
                  <button disabled className="admin-btn-success flex-1 px-4 py-2 text-xs">USER WIN</button>
                  <button disabled className="admin-btn-danger flex-1 px-4 py-2 text-xs">USER LOSE</button>
                  <button disabled className="admin-btn-secondary px-3 py-2 text-xs">NORMAL</button>
                </div>
                <p className="mt-1.5 text-[10px] text-admin-mutedDim">Select a designated test/sandbox user above to enable outcome controls — 🧪 marks test users in the list.</p>
              </div>
            )
          )}

          {selectedUserId && selectedUser && (
            <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-admin-border/60 pt-2 text-[11px] sm:grid-cols-4">
              <div><span className="text-admin-mutedDim">User ID </span><span className="font-mono text-admin-text">{selectedUser.id.slice(0, 8)}</span></div>
              <div><span className="text-admin-mutedDim">Name </span><span className="text-admin-text">{selectedUser.fullName}</span></div>
              <div><span className="text-admin-mutedDim">Email </span><span className="text-admin-text">{selectedUser.email}</span></div>
              <div><span className="text-admin-mutedDim">Balance </span><span className="font-mono text-admin-text">{Number(selectedUser.usdtBalance).toLocaleString()} USDT</span></div>
            </div>
          )}
          {selectedUserId && (
            <p className="mt-1.5 text-[10px] text-admin-mutedDim">Showing trades for <span className="text-admin-text">{selectedUser?.email}</span> only — filters Current Trading/Trade List.</p>
          )}

          {/* Create Test User — the ONLY way isTestUser ever becomes true.
              Always creates a brand-new account (see options.service.ts's
              createTestUser); there is no route that sets isTestUser on an
              existing user. */}
          {settingsRes.data?.sandboxControlsAvailable && (
            <div className="mt-2.5 border-t border-admin-border/60 pt-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-admin-mutedDim">Create Test User</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <input className="admin-input min-w-[160px] flex-1 py-1.5 text-xs" placeholder="Email" type="email" value={newTestUserEmail} onChange={(e) => setNewTestUserEmail(e.target.value)} />
                <input className="admin-input min-w-[120px] flex-1 py-1.5 text-xs" placeholder="Full name (optional)" value={newTestUserFullName} onChange={(e) => setNewTestUserFullName(e.target.value)} />
                <input className="admin-input min-w-[140px] flex-1 py-1.5 text-xs" placeholder="Password (12+ chars)" type="password" value={newTestUserPassword} onChange={(e) => setNewTestUserPassword(e.target.value)} />
                <button onClick={requestCreateTestUser} className="admin-btn-success px-3 py-1.5 text-xs"><UserPlus className="h-3.5 w-3.5" /> Create</button>
              </div>
            </div>
          )}
        </div>

        {/* Current Trading — real active trades, all customers */}
        <div>
          <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-admin-gold">🔥 Current Trading</h3>
          <AdminPanel loading={activeTradesRes.loading} error={activeTradesRes.error} refetch={activeTradesRes.refetch}>
            {(activeTradesRes.data ?? []).length === 0 ? (
              <div className="admin-card p-4 text-center text-xs text-admin-mutedDim">No active trades</div>
            ) : (
              <AdminTable>
                <AdminTableHead columns={[
                  { label: 'ID' }, { label: 'User' }, { label: 'Coin' }, { label: 'Amount', align: 'right' },
                  { label: 'Duration' }, { label: 'Status' }, { label: 'Action', align: 'right' },
                ]} />
                <tbody>
                  {(activeTradesRes.data ?? []).map((t) => (
                    <tr key={t.id} className="border-b border-admin-border/60 hover:bg-admin-surface/50">
                      <td className="px-3 py-1.5 font-mono text-[11px] text-admin-mutedDim">{t.id.slice(0, 8)}</td>
                      <td className="px-3 py-1.5 text-admin-text">{t.user.email}</td>
                      <td className="px-3 py-1.5 text-admin-muted">{t.symbol}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-admin-text">{Number(t.investment).toLocaleString()} {t.currency}</td>
                      <td className="px-3 py-1.5 text-admin-muted">{t.durationSeconds}s</td>
                      <td className="px-3 py-1.5"><AdminStatusBadge tone={tradeStatusTone(t.status)}>{t.status}</AdminStatusBadge></td>
                      <td className="px-3 py-1.5 text-right">
                        {t.status === 'UNRESOLVED' && <button onClick={retrySweep} disabled={sweeping} className="admin-btn-info px-2 py-0.5 text-[10px]">Retry</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </AdminTable>
            )}
          </AdminPanel>
        </div>

        {/* Trade List — real trade history, all customers */}
        <div>
          <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-admin-gold">Trade List</h3>
          <AdminPanel loading={allTradesRes.loading} error={allTradesRes.error} refetch={allTradesRes.refetch}>
            {(allTradesRes.data ?? []).length === 0 ? (
              <div className="admin-card p-4 text-center text-xs text-admin-mutedDim">No trades found</div>
            ) : (
              <AdminTable>
                <AdminTableHead columns={[
                  { label: 'ID' }, { label: 'User' }, { label: 'Coin' }, { label: 'Side' }, { label: 'Amount', align: 'right' },
                  { label: 'Duration' }, { label: 'Result' }, { label: 'Status' }, { label: 'Date' },
                ]} />
                <tbody>
                  {(allTradesRes.data ?? []).map((t) => (
                    <tr key={t.id} className="border-b border-admin-border/60 hover:bg-admin-surface/50">
                      <td className="px-3 py-1.5 font-mono text-[11px] text-admin-mutedDim">{t.id.slice(0, 8)}</td>
                      <td className="px-3 py-1.5 text-admin-text">{t.user.email}</td>
                      <td className="px-3 py-1.5 text-admin-muted">{t.symbol}</td>
                      <td className="px-3 py-1.5 text-admin-muted">{t.direction}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-admin-text">{Number(t.investment).toLocaleString()} {t.currency}</td>
                      <td className="px-3 py-1.5 text-admin-muted">{t.durationSeconds}s</td>
                      <td className="px-3 py-1.5">{t.result ? <AdminStatusBadge tone={statusTone(t.result)}>{t.result}</AdminStatusBadge> : <span className="text-admin-mutedDim">—</span>}</td>
                      <td className="px-3 py-1.5">{(() => { const label = t.status === 'UNRESOLVED' ? 'PENDING' : t.status; return <AdminStatusBadge tone={tradeStatusTone(label)}>{label}</AdminStatusBadge> })()}</td>
                      <td className="px-3 py-1.5 text-admin-mutedDim">{new Date(t.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </AdminTable>
            )}
          </AdminPanel>
        </div>

        {/* Kill switch + risk limits */}
        <AdminPanel loading={settingsRes.loading} error={settingsRes.error} refetch={settingsRes.refetch}>
          {settingsRes.data && (
            <div className="admin-card p-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wide text-admin-gold">Kill Switch</h3>
                <button
                  onClick={() => setStepUp({ kind: 'settings', patch: { tradingEnabled: !settingsRes.data!.tradingEnabled } })}
                  className={`rounded-full px-3 py-1 text-[11px] font-bold ${settingsRes.data.tradingEnabled ? 'bg-bear/15 text-bear' : 'border border-admin-border bg-admin-surface2 text-admin-mutedDim'}`}
                >
                  {settingsRes.data.tradingEnabled ? 'ON' : 'OFF'}
                </button>
              </div>

              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <NumberSetting
                  label="Max active trades/user"
                  value={settingsRes.data.maxActiveTradesPerUser}
                  onSave={(v) => setStepUp({ kind: 'settings', patch: { maxActiveTradesPerUser: v } })}
                />
                <NumberSetting
                  label="Max exposure/user"
                  value={settingsRes.data.maxExposurePerUser ? Number(settingsRes.data.maxExposurePerUser) : null}
                  onSave={(v) => setStepUp({ kind: 'settings', patch: { maxExposurePerUser: v != null ? String(v) : undefined } })}
                />
              </div>
              {!settingsRes.data.sandboxControlsAvailable && (
                <p className="mt-2 text-[10px] text-admin-mutedDim">No manual outcome controls exist — see the notice on Admin &gt; Trade Management for why. All changes require step-up re-authentication.</p>
              )}
            </div>
          )}
        </AdminPanel>

        {/* Stats */}
        <AdminPanel loading={statsRes.loading} error={statsRes.error} refetch={statsRes.refetch}>
          {statsRes.data && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <AdminStat label="Active" value={statsRes.data.activeTrades} />
              <AdminStat label="Completed" value={statsRes.data.completedTrades} />
              <AdminStat label="W/L/D" value={`${statsRes.data.wins}/${statsRes.data.losses}/${statsRes.data.draws}`} />
              <AdminStat label="Unresolved" value={statsRes.data.unresolvedTrades} />
              <AdminStat label="Investment" value={`${Number(statsRes.data.totalInvestment).toLocaleString()} USDT`} />
              <AdminStat label="Payouts" value={`${Number(statsRes.data.totalPayouts).toLocaleString()} USDT`} />
            </div>
          )}
        </AdminPanel>

        {/* Unresolved trades */}
        {unresolvedRes.data && unresolvedRes.data.count > 0 && (
          <div className="admin-card overflow-hidden border-admin-gold/30">
            <div className="flex items-center justify-between border-b border-admin-border px-3 py-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-admin-gold">Unresolved ({unresolvedRes.data.count})</h3>
              <button onClick={retrySweep} disabled={sweeping} className="admin-btn-info px-2.5 py-1 text-[11px]"><RefreshCw className="h-3 w-3" /> {sweeping ? 'Retrying…' : 'Retry now'}</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="bg-admin-surface text-[10px] uppercase tracking-wide text-admin-mutedDim"><th className="px-3 py-1.5 text-left font-medium">Symbol</th><th className="px-3 py-1.5 text-left font-medium">Investment</th><th className="px-3 py-1.5 text-left font-medium">Expired</th><th className="px-3 py-1.5 text-left font-medium">Reason</th></tr></thead>
                <tbody>
                  {unresolvedRes.data.trades.map((t: any) => (
                    <tr key={t.id} className="border-t border-admin-border/60">
                      <td className="px-3 py-1.5 text-admin-text">{t.symbol}</td>
                      <td className="px-3 py-1.5 font-mono">{t.investment} {t.currency}</td>
                      <td className="px-3 py-1.5 text-admin-muted">{new Date(t.expiryAt).toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-admin-mutedDim">{t.rejectionReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Asset / duration / payout configuration */}
        <AdminPanel loading={marketsRes.loading} error={marketsRes.error} refetch={marketsRes.refetch}>
          <div className="admin-card p-3">
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-admin-gold">Add Asset</h3>
            <div className="mt-2 flex gap-2">
              <input className="admin-input flex-1 py-1.5 text-xs" placeholder="BTC/USDT" value={newSymbol} onChange={(e) => setNewSymbol(e.target.value)} />
              <button onClick={createMarket} className="admin-btn-success px-3 py-1.5 text-xs"><Plus className="h-3.5 w-3.5" /> Add</button>
            </div>
          </div>

          <div className="mt-2 space-y-2">
            {(marketsRes.data ?? []).map((m) => (
              <OptionMarketRow key={m.id} market={m} onToggle={toggleMarket} onUpsertDuration={upsertDuration} />
            ))}
          </div>
        </AdminPanel>

        {stepUp && (
          <StepUpModal
            title={
              stepUp.kind === 'settings' ? 'Change options-trading settings'
                : stepUp.kind === 'createTestUser' ? 'Create test/sandbox user'
                  : 'Change test user outcome mode'
            }
            description={
              stepUp.kind === 'settings' ? 'Platform-wide options controls require step-up re-authentication.'
                : stepUp.kind === 'createTestUser' ? 'Creates a brand-new, dedicated test/sandbox account — never modifies an existing user.'
                  : 'Only takes effect for this designated test/sandbox user\'s own test trades, in development/test only.'
            }
            onConfirm={async ({ reason, confirmPassword }) => {
              if (stepUp.kind === 'settings') {
                const res = await tryAction(() => api.patch('/admin/options/settings', { ...stepUp.patch, reason, confirmPassword }))
                if (res.ok) { push('success', 'Options settings updated.'); setStepUp(null); settingsRes.refetch() }
                else throw new ApiError(0, res.error, null)
              } else if (stepUp.kind === 'createTestUser') {
                const res = await tryAction(() => api.post<Omit<AdminUserRow, 'usdtBalance'>>('/admin/options/test-users', {
                  email: stepUp.email, fullName: stepUp.fullName || undefined, password: stepUp.password, reason, confirmPassword,
                }))
                if (res.ok) {
                  push('success', `Test user ${res.data.email} created.`)
                  setStepUp(null)
                  const created: AdminUserRow = { ...res.data, usdtBalance: '0' }
                  setUserResults((prev) => [created, ...(prev ?? [])])
                  setSelectedUserId(created.id)
                  setNewTestUserEmail(''); setNewTestUserFullName(''); setNewTestUserPassword('')
                } else throw new ApiError(0, res.error, null)
              } else {
                const res = await tryAction(() => api.patch(`/admin/options/test-users/${encodeURIComponent(stepUp.userId)}`, {
                  testOutcomeMode: stepUp.testOutcomeMode, reason, confirmPassword,
                }))
                if (res.ok) {
                  push('success', 'Test user outcome mode updated.')
                  setStepUp(null)
                  setUserResults((prev) => prev?.map((u) => (u.id === stepUp.userId ? { ...u, testOutcomeMode: stepUp.testOutcomeMode } : u)) ?? prev)
                } else throw new ApiError(0, res.error, null)
              }
            }}
            onClose={() => setStepUp(null)}
          />
        )}
      </div>
    </div>
  )
}

function NumberSetting({ label, value, onSave }: { label: string; value: number | null; onSave: (v: number | null) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value != null ? String(value) : '')
  return (
    <div className="admin-surface px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-admin-mutedDim">{label}</p>
      {editing ? (
        <div className="mt-1 flex gap-1.5">
          <input className="admin-input py-1 text-xs" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Unlimited" />
          <button onClick={() => { onSave(draft.trim() === '' ? null : Number(draft)); setEditing(false) }} className="admin-btn-success px-2 py-1 text-[11px]">Save</button>
        </div>
      ) : (
        <div className="mt-1 flex items-center justify-between">
          <p className="font-mono text-sm font-bold text-admin-text">{value ?? 'Unlimited'}</p>
          <button onClick={() => setEditing(true)} className="admin-btn-info px-2 py-1 text-[11px]">Edit</button>
        </div>
      )}
    </div>
  )
}

function OptionMarketRow({
  market, onToggle, onUpsertDuration,
}: {
  market: OptionMarketAdminRow
  onToggle: (symbol: string, enabled: boolean) => void
  onUpsertDuration: (symbol: string, durationSeconds: number, payoutPercent: string, enabled: boolean, minAmount?: string) => void
}) {
  const [durationSeconds, setDurationSeconds] = useState('')
  const [payoutPercent, setPayoutPercent] = useState('')
  const [minAmount, setMinAmount] = useState('')

  return (
    <div className="admin-card p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-admin-text">{market.symbol}</p>
          <p className="text-[11px] text-admin-mutedDim">{market.currency} · min {market.minInvestment} · max {market.maxInvestment ?? 'unlimited'}</p>
        </div>
        <span className={`admin-badge ${market.enabled ? 'border-bull/30 bg-bull/10 text-bull' : 'border-bear/30 bg-bear/10 text-bear'}`}>
          {market.enabled ? 'ENABLED' : 'DISABLED'}
        </span>
        <button onClick={() => onToggle(market.symbol, !market.enabled)} className={`ml-2 px-2 py-1 text-[11px] ${market.enabled ? 'admin-btn-danger' : 'admin-btn-success'}`}>
          {market.enabled ? 'Disable' : 'Enable'}
        </button>
      </div>

      <p className="mt-2 text-[10px] text-admin-mutedDim">
        Amount-tier trading ticket: the customer's trade ticket resolves duration + profit automatically from whichever amount they enter (the tier with the highest "Tier Min" at or below it) — never a manually picked duration. Set each tier's minimum here.
      </p>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead><tr className="text-admin-mutedDim"><th className="py-1 text-left font-medium">Duration</th><th className="py-1 text-left font-medium">Payout %</th><th className="py-1 text-left font-medium">Tier Min ({market.currency})</th><th className="py-1 text-left font-medium">Status</th><th className="py-1 text-right font-medium">Action</th></tr></thead>
          <tbody>
            {market.durations.map((d) => (
              <DurationRow key={d.durationSeconds} symbol={market.symbol} duration={d} onUpsertDuration={onUpsertDuration} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <input className="admin-input w-20 py-1 text-[11px]" placeholder="Seconds" type="number" value={durationSeconds} onChange={(e) => setDurationSeconds(e.target.value)} />
        <input className="admin-input w-20 py-1 text-[11px]" placeholder="Payout %" value={payoutPercent} onChange={(e) => setPayoutPercent(e.target.value)} />
        <input className="admin-input w-20 py-1 text-[11px]" placeholder="Tier Min $" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
        <button
          onClick={() => {
            const secs = Number(durationSeconds)
            if (!secs || !payoutPercent.trim()) return
            onUpsertDuration(market.symbol, secs, payoutPercent.trim(), true, minAmount.trim() || '0')
            setDurationSeconds(''); setPayoutPercent(''); setMinAmount('')
          }}
          className="admin-btn-success px-2 py-1 text-[11px]"
        >
          <Plus className="h-3 w-3" /> Add duration
        </button>
      </div>
    </div>
  )
}

function DurationRow({
  symbol, duration, onUpsertDuration,
}: {
  symbol: string
  duration: OptionMarketAdminRow['durations'][number]
  onUpsertDuration: (symbol: string, durationSeconds: number, payoutPercent: string, enabled: boolean, minAmount?: string) => void
}) {
  const [payout, setPayout] = useState(duration.payoutPercent)
  const [minAmount, setMinAmount] = useState(duration.minAmount)
  return (
    <tr className="border-t border-admin-border/60">
      <td className="py-1 font-mono text-admin-text">{duration.durationSeconds}s</td>
      <td className="py-1">
        <div className="flex items-center gap-1">
          <input className="admin-input w-16 py-0.5 text-[11px]" value={payout} onChange={(e) => setPayout(e.target.value)} />
        </div>
      </td>
      <td className="py-1">
        <input className="admin-input w-16 py-0.5 text-[11px]" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
      </td>
      <td className="py-1">
        <span className={duration.enabled ? 'text-bull' : 'text-bear'}>{duration.enabled ? 'Enabled' : 'Disabled'}</span>
      </td>
      <td className="py-1 text-right">
        <button onClick={() => onUpsertDuration(symbol, duration.durationSeconds, payout, duration.enabled, minAmount)} className="admin-btn-success mr-1 px-1.5 py-0.5 text-[10px]">Save</button>
        <button onClick={() => onUpsertDuration(symbol, duration.durationSeconds, duration.payoutPercent, !duration.enabled)} className={`px-1.5 py-0.5 text-[10px] ${duration.enabled ? 'admin-btn-danger' : 'admin-btn-success'}`}>
          {duration.enabled ? 'Disable' : 'Enable'}
        </button>
      </td>
    </tr>
  )
}
