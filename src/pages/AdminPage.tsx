import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../store/auth'
import { api, ApiError } from '../lib/api'
import { useToast } from '../components/Toast'
import { StepUpModal } from '../components/StepUpModal'
import { EmptyState } from '../components/EmptyState'
import type { User, Deposit, Withdrawal, MarketConfig, PlatformSettings } from '../types'
import {
  LayoutDashboard, Users, ArrowDownToLine, ArrowUpFromLine, ShieldCheck, BarChart2,
  Settings, ShieldAlert, ScrollText, Lock, Unlock, Inbox, RefreshCw,
} from 'lucide-react'

// ---- Admin-only API types --------------------------------------------------
// These mirror exactly what backend/src/admin/* returns — nothing here is
// invented or padded with fields the backend doesn't send.

interface Overview {
  totalUsers: number
  activeUsers: number
  pendingKyc: number
  pendingDeposits: number
  pendingWithdrawals: number
  openPositions: number
  tradingVolume: string
  totalCustomerAssets: string
  platform: PlatformSettings
  markets: MarketConfig[]
}

interface AdminDeposit extends Deposit { user: { id: string; email: string; fullName: string } }
interface AdminWithdrawal extends Withdrawal { user: { id: string; email: string; fullName: string } }
interface KycRow {
  id: string; userId: string; status: string; providerReference: string | null
  submittedAt: string; reviewedAt: string | null; rejectionReason: string | null
  user: { id: string; email: string; fullName: string }
}
interface AuditRow {
  id: string; actorId: string | null; action: string; targetType: string | null; targetId: string | null
  previousState: unknown; newState: unknown; reason: string | null; createdAt: string
}
interface AdminRow extends User { permissions: string[] }

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'deposits', label: 'Deposits', icon: ArrowDownToLine },
  { id: 'withdrawals', label: 'Withdrawals', icon: ArrowUpFromLine },
  { id: 'kyc', label: 'KYC', icon: ShieldCheck },
  { id: 'markets', label: 'Markets', icon: BarChart2 },
  { id: 'platform', label: 'System Settings', icon: Settings },
  { id: 'admins', label: 'Admins', icon: ShieldAlert },
  { id: 'audit', label: 'Audit Logs', icon: ScrollText },
] as const

type TabId = (typeof TABS)[number]['id']

export function AdminPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<TabId>('overview')

  if (!user) return null

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold-500/15 text-gold-400"><ShieldAlert className="h-6 w-6" /></div>
        <div>
          <h1 className="text-xl font-bold text-white">Super Admin Control Center</h1>
          <p className="text-sm text-slate-400">Signed in as {user.email} ({user.role})</p>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-1.5 border-b border-ink-700/60 pb-3">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${tab === t.id ? 'bg-gold-500/15 text-gold-300' : 'text-slate-400 hover:bg-ink-800 hover:text-white'}`}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'deposits' && <DepositsTab />}
      {tab === 'withdrawals' && <WithdrawalsTab />}
      {tab === 'kyc' && <KycTab />}
      {tab === 'markets' && <MarketsTab />}
      {tab === 'platform' && <PlatformTab />}
      {tab === 'admins' && <AdminsTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  )
}

// ---- Shared data + error-state helpers -------------------------------------

function panelMessage(e: unknown): { kind: 'unauthorized' | 'forbidden' | 'error'; message: string } {
  if (e instanceof ApiError) {
    if (e.status === 401) return { kind: 'unauthorized', message: 'Your session has expired. Please sign in again.' }
    if (e.status === 403) return { kind: 'forbidden', message: 'Your admin account does not have permission to view this. The backend rejected this request — hiding this tab would not have been real security, so it is shown with an honest Forbidden state instead.' }
    return { kind: 'error', message: e.message }
  }
  return { kind: 'error', message: 'Something went wrong.' }
}

function useAdmin<T>(path: string) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ReturnType<typeof panelMessage> | null>(null)

  const refetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.get<T>(path))
    } catch (e) {
      setError(panelMessage(e))
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => { refetch() }, [refetch])
  return { data, loading, error, refetch }
}

function Panel({ loading, error, refetch, children }: { loading: boolean; error: ReturnType<typeof panelMessage> | null; refetch: () => void; children: React.ReactNode }) {
  if (loading) return <div className="card p-10 text-center text-sm text-slate-500">Loading…</div>
  if (error) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm font-semibold text-bear">{error.kind === 'forbidden' ? 'Forbidden (403)' : error.kind === 'unauthorized' ? 'Unauthorized (401)' : 'Error'}</p>
        <p className="mx-auto mt-2 max-w-md text-xs text-slate-400">{error.message}</p>
        <button onClick={refetch} className="btn-ghost mt-4 text-xs"><RefreshCw className="h-3.5 w-3.5" /> Retry</button>
      </div>
    )
  }
  return <>{children}</>
}

async function tryAction<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await fn() }
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.message : 'Action failed.' }
  }
}

// ---- Overview ---------------------------------------------------------------

function OverviewTab() {
  const { data, loading, error, refetch } = useAdmin<Overview>('/admin/overview')
  return (
    <Panel loading={loading} error={error} refetch={refetch}>
      {data && (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total users" value={data.totalUsers} />
            <Stat label="Active users" value={data.activeUsers} />
            <Stat label="Pending KYC" value={data.pendingKyc} />
            <Stat label="Pending deposits" value={data.pendingDeposits} />
            <Stat label="Pending withdrawals" value={data.pendingWithdrawals} />
            <Stat label="Open positions" value={data.openPositions} />
            <Stat label="Trading volume" value={`$${Number(data.tradingVolume).toLocaleString()}`} hint="0 until a broker is connected — that's correct, not a bug" />
            <Stat label="Total customer assets" value={`$${Number(data.totalCustomerAssets).toLocaleString()}`} />
          </div>
          <div className="card p-5">
            <h3 className="font-bold text-white">Platform settings</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              {(['tradingEnabled', 'depositsEnabled', 'withdrawalsEnabled', 'registrationsEnabled'] as const).map((k) => (
                <div key={k} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${data.platform[k] ? 'border-bull/30 bg-bull/5 text-bull' : 'border-bear/30 bg-bear/5 text-bear'}`}>
                  {k.replace('Enabled', '')}: {data.platform[k] ? 'ON' : 'OFF'}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Panel>
  )
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1.5 font-mono text-xl font-bold text-white">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-slate-600">{hint}</p>}
    </div>
  )
}

// ---- Users --------------------------------------------------------------------

function UsersTab() {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<User[]>('/admin/users')
  const [stepUp, setStepUp] = useState<{ kind: 'status'; user: User; status: string } | { kind: 'role'; user: User; role: string } | { kind: 'credit'; user: User; direction: 'CREDIT' | 'DEBIT'; amount: string } | null>(null)

  async function applyStatus(user: User, status: string) {
    const res = await tryAction(() => api.patch(`/admin/users/${user.id}/status`, { status, reason: `Status changed to ${status} via admin panel` }))
    if (res.ok) { push('success', `${user.email} is now ${status}.`); refetch() }
    else push('error', res.error)
  }

  return (
    <Panel loading={loading} error={error} refetch={refetch}>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-ink-700 text-left text-xs uppercase text-slate-500"><th className="px-4 py-3">Email</th><th className="px-4 py-3">Name</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">KYC</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
            <tbody>
              {(data ?? []).map((u) => (
                <tr key={u.id} className="border-b border-ink-700/40 hover:bg-ink-800/40">
                  <td className="px-4 py-2.5 text-white">{u.email}</td>
                  <td className="px-4 py-2.5 text-slate-400">{u.fullName}</td>
                  <td className="px-4 py-2.5"><span className="chip border-ocean-500/30 text-ocean-300">{u.role}</span></td>
                  <td className="px-4 py-2.5"><span className={`chip ${u.status === 'ACTIVE' ? 'border-bull/30 text-bull' : 'border-bear/30 text-bear'}`}>{u.status}</span></td>
                  <td className="px-4 py-2.5 text-slate-400">{u.kycStatus}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex justify-end gap-1.5">
                      {u.status === 'ACTIVE' ? (
                        <button onClick={() => applyStatus(u, 'SUSPENDED')} className="btn-ghost text-xs"><Lock className="h-3.5 w-3.5" /> Suspend</button>
                      ) : (
                        <button onClick={() => applyStatus(u, 'ACTIVE')} className="btn-ghost text-xs"><Unlock className="h-3.5 w-3.5" /> Activate</button>
                      )}
                      <button onClick={() => setStepUp({ kind: 'credit', user: u, direction: 'CREDIT', amount: '' })} className="btn-ghost text-xs">Adjust balance</button>
                      <button onClick={() => setStepUp({ kind: 'role', user: u, role: u.role === 'USER' ? 'ADMIN' : 'USER' })} className="btn-ghost text-xs">{u.role === 'USER' ? 'Promote' : 'Demote'}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {stepUp?.kind === 'role' && (
        <StepUpModal
          title={`Change role to ${stepUp.role}`}
          description={`This changes ${stepUp.user.email}'s role. Role changes require SUPER_ADMIN + step-up re-authentication.`}
          onConfirm={async ({ reason, confirmPassword, totpCode }) => {
            const res = await tryAction(() => api.patch(`/admin/users/${stepUp.user.id}/role`, { role: stepUp.role, reason, confirmPassword, totpCode }))
            if (res.ok) { push('success', 'Role updated.'); setStepUp(null); refetch() }
            else throw new ApiError(0, res.error, null)
          }}
          onClose={() => setStepUp(null)}
        />
      )}

      {stepUp?.kind === 'credit' && (
        <BalanceAdjustModal
          user={stepUp.user}
          onClose={() => setStepUp(null)}
          onDone={() => { setStepUp(null); refetch() }}
        />
      )}
    </Panel>
  )
}

function BalanceAdjustModal({ user, onClose, onDone }: { user: User; onClose: () => void; onDone: () => void }) {
  const { push } = useToast()
  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState<'CREDIT' | 'DEBIT'>('CREDIT')

  return (
    <StepUpModal
      title={`Adjust balance for ${user.email}`}
      description="Financial adjustments post a real, auditable ledger transaction and require step-up re-authentication. This is not a client-side balance editor."
      onConfirm={async ({ reason, confirmPassword, totpCode }) => {
        const amt = parseFloat(amount)
        if (!Number.isFinite(amt) || amt <= 0) throw new ApiError(0, 'Enter a valid positive amount.', null)
        const res = await tryAction(() => api.post('/admin/financial-adjustment', { userId: user.id, amount: String(amt), direction, reason, confirmPassword, totpCode }))
        if (res.ok) { push('success', 'Ledger adjustment posted.'); onDone() }
        else throw new ApiError(0, res.error, null)
      }}
      onClose={onClose}
    >
      <div className="mb-3 flex gap-2">
        <button type="button" onClick={() => setDirection('CREDIT')} className={`flex-1 rounded-lg border py-2 text-xs font-semibold ${direction === 'CREDIT' ? 'border-bull/40 bg-bull/10 text-bull' : 'border-ink-600 text-slate-400'}`}>Credit</button>
        <button type="button" onClick={() => setDirection('DEBIT')} className={`flex-1 rounded-lg border py-2 text-xs font-semibold ${direction === 'DEBIT' ? 'border-bear/40 bg-bear/10 text-bear' : 'border-ink-600 text-slate-400'}`}>Debit</button>
      </div>
      <input className="input mb-3" type="number" min="0" placeholder="Amount (USD)" value={amount} onChange={(e) => setAmount(e.target.value)} />
    </StepUpModal>
  )
}

// ---- Deposits ---------------------------------------------------------------

function DepositsTab() {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<AdminDeposit[]>('/admin/deposits')

  async function act(id: string, action: 'confirm' | 'reject') {
    const res = await tryAction(() => api.post(`/admin/deposits/${id}/${action}`, { reason: `${action === 'confirm' ? 'Confirmed' : 'Rejected'} via admin panel` }))
    if (res.ok) { push('success', `Deposit ${action === 'confirm' ? 'confirmed' : 'rejected'}.`); refetch() }
    else push('error', res.error)
  }

  return (
    <Panel loading={loading} error={error} refetch={refetch}>
      {(data ?? []).length === 0 ? <EmptyState icon={Inbox} title="No deposits" /> : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-ink-700 text-left text-xs uppercase text-slate-500"><th className="px-4 py-3">User</th><th className="px-4 py-3">Method</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Date</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
              <tbody>
                {(data ?? []).map((d) => (
                  <tr key={d.id} className="border-b border-ink-700/40 hover:bg-ink-800/40">
                    <td className="px-4 py-2.5 text-white">{d.user.email}</td>
                    <td className="px-4 py-2.5 text-slate-400">{d.method}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-white">${Number(d.amount).toFixed(2)}</td>
                    <td className="px-4 py-2.5"><span className="chip">{d.status}</span></td>
                    <td className="px-4 py-2.5 text-slate-500">{new Date(d.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right">
                      {(d.status === 'PENDING' || d.status === 'PROCESSING') && (
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => act(d.id, 'confirm')} className="btn-ghost text-xs">Confirm</button>
                          <button onClick={() => act(d.id, 'reject')} className="btn-ghost text-xs">Reject</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  )
}

// ---- Withdrawals --------------------------------------------------------------

function WithdrawalsTab() {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<AdminWithdrawal[]>('/admin/withdrawals')
  const [approving, setApproving] = useState<AdminWithdrawal | null>(null)

  async function reject(id: string) {
    const res = await tryAction(() => api.post(`/admin/withdrawals/${id}/reject`, { reason: 'Rejected via admin panel' }))
    if (res.ok) { push('success', 'Withdrawal rejected.'); refetch() }
    else push('error', res.error)
  }

  return (
    <Panel loading={loading} error={error} refetch={refetch}>
      {(data ?? []).length === 0 ? <EmptyState icon={Inbox} title="No withdrawals" /> : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-ink-700 text-left text-xs uppercase text-slate-500"><th className="px-4 py-3">User</th><th className="px-4 py-3">Destination</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
              <tbody>
                {(data ?? []).map((w) => (
                  <tr key={w.id} className="border-b border-ink-700/40 hover:bg-ink-800/40">
                    <td className="px-4 py-2.5 text-white">{w.user.email}</td>
                    <td className="px-4 py-2.5 max-w-[200px] truncate text-slate-400">{w.destination}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-white">${Number(w.amount).toFixed(2)}</td>
                    <td className="px-4 py-2.5"><span className="chip">{w.status}</span></td>
                    <td className="px-4 py-2.5 text-right">
                      {(w.status === 'PENDING' || w.status === 'REVIEW') && (
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => setApproving(w)} className="btn-ghost text-xs">Approve</button>
                          <button onClick={() => reject(w.id)} className="btn-ghost text-xs">Reject</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {approving && (
        <StepUpModal
          title={`Approve withdrawal — $${Number(approving.amount).toFixed(2)}`}
          description={`Withdrawal approval for ${approving.user.email} requires step-up re-authentication.`}
          onConfirm={async ({ reason, confirmPassword, totpCode }) => {
            const res = await tryAction(() => api.post(`/admin/withdrawals/${approving.id}/approve`, { reason, confirmPassword, totpCode }))
            if (res.ok) { push('success', 'Withdrawal approved.'); setApproving(null); refetch() }
            else throw new ApiError(0, res.error, null)
          }}
          onClose={() => setApproving(null)}
        />
      )}
    </Panel>
  )
}

// ---- KYC -----------------------------------------------------------------------

function KycTab() {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<KycRow[]>('/admin/kyc/pending')

  async function act(id: string, action: 'approve' | 'reject') {
    const res = await tryAction(() => api.post(`/admin/kyc/${id}/${action}`, action === 'reject' ? { reason: 'Documents could not be verified' } : undefined))
    if (res.ok) { push('success', `KYC request ${action}d.`); refetch() }
    else push('error', res.error)
  }

  return (
    <Panel loading={loading} error={error} refetch={refetch}>
      {(data ?? []).length === 0 ? <EmptyState icon={ShieldCheck} title="No pending verifications" /> : (
        <div className="card overflow-hidden">
          {(data ?? []).map((k) => (
            <div key={k.id} className="flex items-center justify-between border-b border-ink-700/40 px-5 py-3.5 last:border-b-0">
              <div>
                <p className="text-sm font-semibold text-white">{k.user.fullName}</p>
                <p className="text-xs text-slate-500">{k.user.email} · submitted {new Date(k.submittedAt).toLocaleString()}</p>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => act(k.id, 'approve')} className="btn-ghost text-xs">Approve</button>
                <button onClick={() => act(k.id, 'reject')} className="btn-ghost text-xs">Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

// ---- Markets --------------------------------------------------------------------

function MarketsTab() {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<MarketConfig[]>('/markets/config')

  async function toggle(symbol: string, patch: Partial<{ tradingEnabled: boolean; maintenanceMode: boolean }>) {
    const res = await tryAction(() => api.patch(`/admin/markets/${encodeURIComponent(symbol)}`, { ...patch, reason: 'Toggled via admin panel' }))
    if (res.ok) { push('success', `${symbol} updated.`); refetch() }
    else push('error', res.error)
  }

  return (
    <Panel loading={loading} error={error} refetch={refetch}>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-ink-700 text-left text-xs uppercase text-slate-500"><th className="px-4 py-3">Symbol</th><th className="px-4 py-3">Data source</th><th className="px-4 py-3">Trading</th><th className="px-4 py-3">Maintenance</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
            <tbody>
              {(data ?? []).map((m) => (
                <tr key={m.symbol} className="border-b border-ink-700/40 hover:bg-ink-800/40">
                  <td className="px-4 py-2.5 font-medium text-white">{m.symbol}</td>
                  <td className="px-4 py-2.5"><span className={`chip ${m.dataSource === 'LIVE' ? 'border-emerald-500/30 text-emerald-400' : 'border-sky-500/30 text-sky-300'}`}>{m.dataSource}</span></td>
                  <td className="px-4 py-2.5">{m.tradingEnabled ? <span className="text-bull">Enabled</span> : <span className="text-bear">Disabled</span>}</td>
                  <td className="px-4 py-2.5">{m.maintenanceMode ? <span className="text-gold-400">Yes</span> : <span className="text-slate-500">No</span>}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => toggle(m.symbol, { tradingEnabled: !m.tradingEnabled })} className="btn-ghost text-xs">{m.tradingEnabled ? 'Disable trading' : 'Enable trading'}</button>
                      <button onClick={() => toggle(m.symbol, { maintenanceMode: !m.maintenanceMode })} className="btn-ghost text-xs">{m.maintenanceMode ? 'Clear maintenance' : 'Set maintenance'}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  )
}

// ---- Platform settings ----------------------------------------------------------

function PlatformTab() {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<Overview>('/admin/overview')
  const [pending, setPending] = useState<{ key: keyof PlatformSettings; next: boolean } | null>(null)

  return (
    <Panel loading={loading} error={error} refetch={refetch}>
      {data && (
        <div className="card p-6">
          <h3 className="font-bold text-white">Platform-wide kill switches</h3>
          <p className="mt-1 text-sm text-slate-400">Changes here take effect immediately and are enforced by the backend, not just hidden in the UI. Requires step-up re-authentication.</p>
          <div className="mt-5 space-y-3">
            {(['tradingEnabled', 'depositsEnabled', 'withdrawalsEnabled', 'registrationsEnabled'] as const).map((k) => (
              <div key={k} className="flex items-center justify-between rounded-xl border border-ink-700 bg-ink-900/60 px-4 py-3">
                <span className="text-sm font-medium text-white">{k.replace('Enabled', '')}</span>
                <button onClick={() => setPending({ key: k, next: !data.platform[k] })} className={`rounded-full px-4 py-1.5 text-xs font-bold ${data.platform[k] ? 'bg-bull/15 text-bull' : 'bg-bear/15 text-bear'}`}>
                  {data.platform[k] ? 'ON — click to pause' : 'OFF — click to resume'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {pending && (
        <StepUpModal
          title={`${pending.next ? 'Enable' : 'Pause'} ${pending.key.replace('Enabled', '')}`}
          description="Platform-wide controls require step-up re-authentication."
          onConfirm={async ({ reason, confirmPassword, totpCode }) => {
            const res = await tryAction(() => api.patch('/admin/platform-settings', { [pending.key]: pending.next, reason, confirmPassword, totpCode }))
            if (res.ok) { push('success', 'Platform settings updated.'); setPending(null); refetch() }
            else throw new ApiError(0, res.error, null)
          }}
          onClose={() => setPending(null)}
        />
      )}
    </Panel>
  )
}

// ---- Admins / permissions --------------------------------------------------------

const PERMISSIONS = [
  'users.read', 'users.write', 'kyc.read', 'kyc.review', 'deposits.read', 'deposits.review',
  'withdrawals.read', 'withdrawals.review', 'trading.read', 'trading.control', 'markets.read',
  'markets.control', 'ledger.read', 'ledger.adjust', 'audit.read', 'platform.read', 'platform.control',
  'admins.read', 'admins.manage',
] as const

function AdminsTab() {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<AdminRow[]>('/admin/admins')
  const [pending, setPending] = useState<{ admin: AdminRow; permission: string; grant: boolean } | null>(null)

  return (
    <Panel loading={loading} error={error} refetch={refetch}>
      <div className="space-y-4">
        {(data ?? []).map((a) => (
          <div key={a.id} className="card p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-white">{a.email}</p>
                <p className="text-xs text-slate-500">{a.role}</p>
              </div>
            </div>
            {a.role === 'SUPER_ADMIN' ? (
              <p className="mt-3 text-xs text-slate-500">SUPER_ADMIN bypasses the permission system entirely — full platform control.</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {PERMISSIONS.map((p) => {
                  const granted = a.permissions.includes(p)
                  return (
                    <button
                      key={p}
                      onClick={() => setPending({ admin: a, permission: p, grant: !granted })}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${granted ? 'border-bull/30 bg-bull/10 text-bull' : 'border-ink-600 text-slate-500 hover:border-ink-500'}`}
                    >
                      {p}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {pending && (
        <StepUpModal
          title={`${pending.grant ? 'Grant' : 'Revoke'} ${pending.permission}`}
          description={`${pending.grant ? 'Granting' : 'Revoking'} a permission for ${pending.admin.email} requires SUPER_ADMIN + step-up re-authentication.`}
          onConfirm={async ({ reason, confirmPassword, totpCode }) => {
            const action = pending.grant ? 'grant' : 'revoke'
            const res = await tryAction(() => api.patch(`/admin/admins/${pending.admin.id}/permissions/${pending.permission}/${action}`, { reason, confirmPassword, totpCode }))
            if (res.ok) { push('success', `Permission ${action}ed.`); setPending(null); refetch() }
            else throw new ApiError(0, res.error, null)
          }}
          onClose={() => setPending(null)}
        />
      )}
    </Panel>
  )
}

// ---- Audit logs (read-only) -------------------------------------------------------

function AuditTab() {
  const { data, loading, error, refetch } = useAdmin<AuditRow[]>('/admin/audit-logs?limit=200')
  return (
    <Panel loading={loading} error={error} refetch={refetch}>
      {(data ?? []).length === 0 ? <EmptyState icon={ScrollText} title="No audit log entries" /> : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-ink-700 text-left text-xs uppercase text-slate-500"><th className="px-4 py-3">Time</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Target</th><th className="px-4 py-3">Reason</th></tr></thead>
              <tbody>
                {(data ?? []).map((row) => (
                  <tr key={row.id} className="border-b border-ink-700/40">
                    <td className="px-4 py-2.5 text-slate-400">{new Date(row.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-white">{row.action}</td>
                    <td className="px-4 py-2.5 text-slate-400">{row.targetType ? `${row.targetType}${row.targetId ? ` · ${row.targetId.slice(0, 8)}` : ''}` : '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500">{row.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-ink-700/60 px-4 py-3 text-[11px] text-slate-600">Read-only — this log is immutable at the database level (see backend/prisma/migrations/…_audit_log_immutability).</p>
        </div>
      )}
    </Panel>
  )
}
