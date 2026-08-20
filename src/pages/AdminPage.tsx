import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../store/auth'
import { api, ApiError } from '../lib/api'
import { useToast } from '../components/Toast'
import { StepUpModal } from '../components/StepUpModal'
import { EmptyState } from '../components/EmptyState'
import type { User, Deposit, Withdrawal, MarketConfig, PlatformSettings, CmsPage, CmsAnnouncement, CmsFaq, CmsMedia, SupportTicket, SupportCategory } from '../types'
import { mediaUrl, attachmentUrl, adminKycDocumentUrl } from '../lib/api'
import {
  LayoutDashboard, Users, ArrowDownToLine, ArrowUpFromLine, ShieldCheck, BarChart2,
  Settings, ShieldAlert, ScrollText, Lock, Unlock, Inbox, RefreshCw, FileText, Headset, Plus,
  Upload, Copy, Trash2, Search, Paperclip, Timer, FlaskConical, Bitcoin, Power, PowerOff,
  ZoomIn, X, ArrowLeft,
} from 'lucide-react'
import type { OptionMarketAdminRow, OptionsSettings as OptionsSettingsType, OptionsStats } from '../types'

interface CryptoNetworkAdminRow { id: string; networkCode: string; networkName: string; enabled: boolean; receivingAddress: string; minimumDeposit: string | null }
interface CryptoAssetAdminRow { id: string; symbol: string; name: string; enabled: boolean; networks: CryptoNetworkAdminRow[] }

// The 5 cryptocurrencies an admin can add via Deposit Management. Symbol/name
// are fixed here so the admin picks from a list instead of free-typing them —
// the receiving address (the actual fund-safety-critical value) is still
// entered per-network, below, through the existing step-up-gated flow.
const PREDEFINED_CRYPTO_ASSETS: { symbol: string; name: string }[] = [
  { symbol: 'USDT', name: 'Tether' },
  { symbol: 'BTC', name: 'Bitcoin' },
  { symbol: 'ETH', name: 'Ethereum' },
  { symbol: 'USDC', name: 'USD Coin' },
  { symbol: 'BNB', name: 'BNB' },
]

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
interface KycDocumentRow { id: string; kind: 'FRONT' | 'BACK' | 'SELFIE'; mimeType: string; filename: string; size: number; createdAt: string }
interface KycSubmissionRow {
  id: string; userId: string; status: string
  fullName: string | null; dateOfBirth: string | null; country: string | null
  idType: string | null; idNumber: string | null
  submittedAt: string; reviewedAt: string | null; rejectionReason: string | null
  user: { id: string; email: string; fullName: string }
}
interface KycSubmissionDetail extends KycSubmissionRow { documents: KycDocumentRow[] }
interface AuditRow {
  id: string; actorId: string | null; action: string; targetType: string | null; targetId: string | null
  previousState: unknown; newState: unknown; reason: string | null; createdAt: string
}
interface AdminRow extends User { permissions: string[] }

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'deposits', label: 'Deposits', icon: ArrowDownToLine },
  { id: 'depositManagement', label: 'Deposit Management', icon: Bitcoin },
  { id: 'withdrawals', label: 'Withdrawals', icon: ArrowUpFromLine },
  { id: 'kyc', label: 'KYC', icon: ShieldCheck },
  { id: 'markets', label: 'Markets', icon: BarChart2 },
  { id: 'options', label: 'Options Trading', icon: Timer },
  { id: 'cms', label: 'CMS', icon: FileText },
  { id: 'support', label: 'Support', icon: Headset },
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
      {tab === 'depositManagement' && <DepositManagementTab />}
      {tab === 'withdrawals' && <WithdrawalsTab />}
      {tab === 'kyc' && <KycTab />}
      {tab === 'markets' && <MarketsTab />}
      {tab === 'options' && <OptionsTab />}
      {tab === 'cms' && <CmsTab />}
      {tab === 'support' && <SupportTab />}
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
              <thead><tr className="border-b border-ink-700 text-left text-xs uppercase text-slate-500"><th className="px-4 py-3">User</th><th className="px-4 py-3">Method</th><th className="px-4 py-3">Network / Address</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">Proof</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Date</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
              <tbody>
                {(data ?? []).map((d) => (
                  <tr key={d.id} className="border-b border-ink-700/40 hover:bg-ink-800/40">
                    <td className="px-4 py-2.5 text-white">{d.user.email}</td>
                    <td className="px-4 py-2.5 text-slate-400">{d.cryptoAssetSymbol ? `${d.cryptoAssetSymbol} (Crypto)` : d.method}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">
                      {d.networkCode && <div>{d.networkCode}</div>}
                      {d.receivingAddress && <div className="max-w-[220px] truncate font-mono" title={d.receivingAddress}>{d.receivingAddress}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-white">{Number(d.amount).toFixed(2)} {d.currency}</td>
                    <td className="px-4 py-2.5">
                      {d.proofFilename ? (
                        <a href={`/api/admin/deposits/${d.id}/proof`} target="_blank" rel="noreferrer" className="text-xs text-ocean-400 hover:underline">View</a>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
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

// ---- Deposit Management (Checkpoint K) — crypto asset/network/receiving- ------
// address configuration. Separate from DepositsTab above (that tab reviews
// individual deposit REQUESTS; this one configures what's OFFERED).

function DepositManagementTab() {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<CryptoAssetAdminRow[]>('/admin/crypto-deposits/assets')
  const [selectedSymbol, setSelectedSymbol] = useState('')
  const [stepUp, setStepUp] = useState<{ symbol: string; patch: Record<string, unknown> } | null>(null)

  const configuredSymbols = new Set((data ?? []).map((a) => a.symbol))
  const availableCryptoAssets = PREDEFINED_CRYPTO_ASSETS.filter((c) => !configuredSymbols.has(c.symbol))

  async function createAsset() {
    const chosen = PREDEFINED_CRYPTO_ASSETS.find((c) => c.symbol === selectedSymbol)
    if (!chosen) return
    const res = await tryAction(() => api.post('/admin/crypto-deposits/assets', { symbol: chosen.symbol, name: chosen.name }))
    if (res.ok) { push('success', `${chosen.symbol} added.`); setSelectedSymbol(''); refetch() }
    else push('error', res.error)
  }

  async function toggleAsset(symbol: string, enabled: boolean) {
    const res = await tryAction(() => api.patch(`/admin/crypto-deposits/assets/${encodeURIComponent(symbol)}`, { enabled }))
    if (res.ok) { push('success', `${symbol} ${enabled ? 'enabled' : 'disabled'}.`); refetch() }
    else push('error', res.error)
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gold-500/30 bg-gold-500/10 px-4 py-3 text-xs text-gold-300">
        Receiving-address changes require step-up re-authentication (password + authenticator code) — this is the address real customer deposits get sent to.
      </div>

      <Panel loading={loading} error={error} refetch={refetch}>
        <div className="card p-5">
          <h3 className="font-bold text-white">Add crypto asset</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <select
              className="input flex-1 bg-ink-800"
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              aria-label="Select cryptocurrency"
            >
              <option value="">Select cryptocurrency</option>
              {availableCryptoAssets.map((c) => (
                <option key={c.symbol} value={c.symbol}>{c.symbol} — {c.name}</option>
              ))}
            </select>
            <button onClick={createAsset} disabled={!selectedSymbol} className="btn-gold px-4 disabled:cursor-not-allowed disabled:opacity-50">
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>
          {availableCryptoAssets.length === 0 && (
            <p className="mt-2 text-xs text-slate-500">All 5 supported cryptocurrencies are already configured.</p>
          )}
        </div>

        <div className="mt-4 space-y-4">
          {(data ?? []).map((a) => (
            <CryptoAssetAdminCard key={a.id} asset={a} onToggleAsset={toggleAsset} onRequestAddressChange={(symbol, patch) => setStepUp({ symbol, patch })} />
          ))}
        </div>
      </Panel>

      {stepUp && (
        <StepUpModal
          title={`Update ${stepUp.symbol} receiving address`}
          description="Changing a crypto receiving address is a fund-safety-critical operation and requires step-up re-authentication. New deposits will use this address immediately; existing deposits keep their own historical snapshot."
          onConfirm={async ({ reason, confirmPassword, totpCode }) => {
            const res = await tryAction(() => api.patch(`/admin/crypto-deposits/assets/${encodeURIComponent(stepUp.symbol)}/networks`, { ...stepUp.patch, reason, confirmPassword, totpCode }))
            if (res.ok) { push('success', 'Receiving address updated.'); setStepUp(null); refetch() }
            else throw new ApiError(0, res.error, null)
          }}
          onClose={() => setStepUp(null)}
        />
      )}
    </div>
  )
}

function CryptoAssetAdminCard({
  asset, onToggleAsset, onRequestAddressChange,
}: {
  asset: CryptoAssetAdminRow
  onToggleAsset: (symbol: string, enabled: boolean) => void
  onRequestAddressChange: (symbol: string, patch: Record<string, unknown>) => void
}) {
  const [networkCode, setNetworkCode] = useState('')
  const [networkName, setNetworkName] = useState('')
  const [address, setAddress] = useState('')
  const [minimum, setMinimum] = useState('')

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-bold text-white">{asset.symbol}</p>
          <p className="text-xs text-slate-500">{asset.name}</p>
        </div>
        <button onClick={() => onToggleAsset(asset.symbol, !asset.enabled)} className={`chip flex items-center gap-1 ${asset.enabled ? 'border-bull/30 text-bull' : 'border-bear/30 text-bear'}`}>
          {asset.enabled ? <Power className="h-3 w-3" /> : <PowerOff className="h-3 w-3" />} {asset.enabled ? 'ENABLED' : 'DISABLED'}
        </button>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-slate-500"><th className="py-1 text-left">Network</th><th className="py-1 text-left">Receiving Address</th><th className="py-1 text-left">Min.</th><th className="py-1 text-left">Status</th><th className="py-1 text-right">Actions</th></tr></thead>
          <tbody>
            {asset.networks.map((n) => (
              <tr key={n.id} className="border-t border-ink-700/40">
                <td className="py-1.5 font-medium text-white">{n.networkName} <span className="text-slate-500">({n.networkCode})</span></td>
                <td className="max-w-[200px] truncate py-1.5 font-mono text-slate-400" title={n.receivingAddress}>{n.receivingAddress}</td>
                <td className="py-1.5 text-slate-400">{n.minimumDeposit ?? '—'}</td>
                <td className="py-1.5"><span className={n.enabled ? 'text-bull' : 'text-bear'}>{n.enabled ? 'ACTIVE' : 'DISABLED'}</span></td>
                <td className="py-1.5 text-right">
                  <div className="flex justify-end gap-1.5">
                    <button
                      onClick={() => onRequestAddressChange(asset.symbol, { networkCode: n.networkCode, networkName: n.networkName, receivingAddress: n.receivingAddress, minimumDeposit: n.minimumDeposit ?? undefined })}
                      className="btn-ghost px-2 py-0.5 text-[11px]"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => onRequestAddressChange(asset.symbol, { networkCode: n.networkCode, networkName: n.networkName, receivingAddress: n.receivingAddress, enabled: !n.enabled })}
                      className="btn-ghost px-2 py-0.5 text-[11px]"
                    >
                      {n.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <input className="input py-1 text-xs" placeholder="Network code (TRC20)" value={networkCode} onChange={(e) => setNetworkCode(e.target.value)} />
        <input className="input py-1 text-xs" placeholder="Network name" value={networkName} onChange={(e) => setNetworkName(e.target.value)} />
        <input className="input py-1 text-xs sm:col-span-2" placeholder="Receiving address" value={address} onChange={(e) => setAddress(e.target.value)} />
        <input className="input py-1 text-xs" placeholder="Min. (optional)" value={minimum} onChange={(e) => setMinimum(e.target.value)} />
      </div>
      <button
        onClick={() => {
          if (!networkCode.trim() || !networkName.trim() || !address.trim()) return
          onRequestAddressChange(asset.symbol, { networkCode: networkCode.trim().toUpperCase(), networkName: networkName.trim(), receivingAddress: address.trim(), minimumDeposit: minimum.trim() || undefined })
          setNetworkCode(''); setNetworkName(''); setAddress(''); setMinimum('')
        }}
        className="btn-ghost mt-2 px-3 text-xs"
      >
        <Plus className="h-3.5 w-3.5" /> Add / Update network
      </button>
    </div>
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

function kycStatusChip(status: string) {
  const cls = status === 'VERIFIED' ? 'border-bull/30 text-bull' : status === 'PENDING' ? 'border-gold-500/30 text-gold-300' : status === 'REJECTED' || status === 'EXPIRED' ? 'border-bear/30 text-bear' : 'border-ink-600 text-slate-400'
  return <span className={`chip ${cls}`}>{status}</span>
}

// Full KYC dashboard (Part 15/16) — every submission, not just PENDING.
// Clicking Review opens KycReviewPanel, which fetches the single-submission
// detail (unmasked idNumber, actual documents) separately — the list view
// never carries more than it needs to render a row.
function KycTab() {
  const { data, loading, error, refetch } = useAdmin<KycSubmissionRow[]>('/admin/kyc/submissions')
  const [reviewId, setReviewId] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      <Panel loading={loading} error={error} refetch={refetch}>
        {(data ?? []).length === 0 ? <EmptyState icon={ShieldCheck} title="No KYC submissions yet" /> : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-ink-700 text-left text-xs uppercase text-slate-500"><th className="px-4 py-3">Customer</th><th className="px-4 py-3">UID</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Submitted</th><th className="px-4 py-3 text-right">Action</th></tr></thead>
                <tbody>
                  {(data ?? []).map((k) => (
                    <tr key={k.id} className="border-b border-ink-700/40 hover:bg-ink-800/40">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-white">{k.user.fullName}</p>
                        <p className="text-xs text-slate-500">{k.user.email}</p>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{k.userId}</td>
                      <td className="px-4 py-2.5">{kycStatusChip(k.status)}</td>
                      <td className="px-4 py-2.5 text-slate-400">{new Date(k.submittedAt).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right"><button onClick={() => setReviewId(k.id)} className="btn-ghost text-xs">Review</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Panel>

      {reviewId && <KycReviewPanel id={reviewId} onClose={() => setReviewId(null)} onActed={() => { setReviewId(null); refetch() }} />}
    </div>
  )
}

function KycReviewPanel({ id, onClose, onActed }: { id: string; onClose: () => void; onActed: () => void }) {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<KycSubmissionDetail>(`/admin/kyc/submissions/${id}`)
  const [rejectionReason, setRejectionReason] = useState('')
  const [acting, setActing] = useState(false)
  const [zoomDoc, setZoomDoc] = useState<KycDocumentRow | null>(null)

  async function approve() {
    setActing(true)
    const res = await tryAction(() => api.post(`/admin/kyc/${id}/approve`))
    setActing(false)
    if (res.ok) { push('success', 'KYC approved.'); onActed() }
    else push('error', res.error)
  }

  async function reject() {
    if (rejectionReason.trim().length < 3) { push('error', 'Enter a rejection reason (at least 3 characters).'); return }
    setActing(true)
    const res = await tryAction(() => api.post(`/admin/kyc/${id}/reject`, { reason: rejectionReason.trim() }))
    setActing(false)
    if (res.ok) { push('success', 'KYC rejected.'); onActed() }
    else push('error', res.error)
  }

  const DOC_LABELS: Record<string, string> = { FRONT: 'Front of ID', BACK: 'Back of ID', SELFIE: 'Selfie / verification photo' }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between">
        <button onClick={onClose} className="btn-ghost text-xs"><ArrowLeft className="h-3.5 w-3.5" /> Back to list</button>
      </div>

      <Panel loading={loading} error={error} refetch={refetch}>
        {data && (
          <div className="mt-4 space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Customer" value={data.user.fullName} />
              <Field label="UID" value={data.userId} mono />
              <Field label="Status" value={<>{kycStatusChip(data.status)}</>} />
              <Field label="ID type" value={data.idType ?? '—'} />
              <Field label="ID number" value={data.idNumber ?? '—'} mono />
              <Field label="Date of birth" value={data.dateOfBirth ? new Date(data.dateOfBirth).toLocaleDateString() : '—'} />
              <Field label="Country" value={data.country ?? '—'} />
              <Field label="Submitted" value={new Date(data.submittedAt).toLocaleString()} />
              {data.rejectionReason && <Field label="Last rejection reason" value={data.rejectionReason} />}
            </div>

            <div>
              <h4 className="mb-2 text-sm font-bold text-white">Documents</h4>
              {data.documents.length === 0 ? (
                <p className="text-sm text-slate-500">No documents on this submission — it predates document upload and cannot be approved until the customer resubmits.</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-3">
                  {data.documents.map((doc) => (
                    <div key={doc.id} className="card overflow-hidden p-3">
                      <p className="mb-2 text-xs font-semibold text-slate-400">{DOC_LABELS[doc.kind] ?? doc.kind}</p>
                      <button onClick={() => setZoomDoc(doc)} className="group relative block w-full overflow-hidden rounded-lg bg-ink-800">
                        <img src={adminKycDocumentUrl(doc.id)} alt={DOC_LABELS[doc.kind] ?? doc.kind} className="h-40 w-full object-contain" />
                        <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
                          <ZoomIn className="h-6 w-6 text-white" />
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-5">
              <h4 className="mb-3 text-sm font-bold text-white">Admin decision</h4>
              <div className="flex flex-wrap gap-2">
                <button onClick={approve} disabled={acting || data.status === 'VERIFIED'} className="btn-gold px-5 py-2 text-xs">Approve</button>
              </div>
              <div className="mt-4">
                <label className="label">Rejection reason</label>
                <textarea className="input min-h-[80px]" value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} placeholder="e.g. ID image is blurry. Please upload a clear image showing all four corners." />
                <button onClick={reject} disabled={acting || data.status === 'REJECTED'} className="btn-ghost mt-2 border-bear/30 text-xs text-bear">Reject</button>
              </div>
            </div>
          </div>
        )}
      </Panel>

      {zoomDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setZoomDoc(null)}>
          <div className="relative max-h-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setZoomDoc(null)} aria-label="Close" className="absolute -top-10 right-0 text-slate-300 hover:text-white"><X className="h-6 w-6" /></button>
            <img src={adminKycDocumentUrl(zoomDoc.id)} alt={DOC_LABELS[zoomDoc.kind] ?? zoomDoc.kind} className="max-h-[85vh] w-auto rounded-lg object-contain" />
            <a href={adminKycDocumentUrl(zoomDoc.id)} target="_blank" rel="noreferrer" className="btn-ghost mt-3 text-xs">Open full size</a>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-0.5 text-sm text-white ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
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
            <thead><tr className="border-b border-ink-700 text-left text-xs uppercase text-slate-500"><th className="px-4 py-3">Symbol</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Provider</th><th className="px-4 py-3">Provider symbol</th><th className="px-4 py-3">Data source</th><th className="px-4 py-3">Listed</th><th className="px-4 py-3">Trading</th><th className="px-4 py-3">Maintenance</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
            <tbody>
              {(data ?? []).map((m) => (
                <tr key={m.symbol} className="border-b border-ink-700/40 hover:bg-ink-800/40">
                  <td className="px-4 py-2.5 font-medium text-white">{m.symbol} <span className="text-xs text-slate-500">{m.displayName}</span></td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">{m.marketType}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">{m.provider ?? <span className="text-bear">none</span>}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{m.providerSymbol ?? '—'}</td>
                  <td className="px-4 py-2.5"><span className={`chip ${m.dataSource === 'LIVE' ? 'border-emerald-500/30 text-emerald-400' : 'border-sky-500/30 text-sky-300'}`}>{m.dataSource}</span></td>
                  <td className="px-4 py-2.5">{m.enabled ? <span className="text-bull">Yes</span> : <span className="text-slate-500">No</span>}</td>
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

// ---- Options Trading (Fixed-Time Options — a separate product from spot) ---

function OptionsTab() {
  const { push } = useToast()
  const settingsRes = useAdmin<OptionsSettingsType>('/admin/options/settings')
  const marketsRes = useAdmin<OptionMarketAdminRow[]>('/admin/options/markets')
  const statsRes = useAdmin<OptionsStats>('/admin/options/stats')
  const unresolvedRes = useAdmin<{ count: number; trades: any[] }>('/admin/options/unresolved')
  const [stepUp, setStepUp] = useState<{ kind: 'settings'; patch: Record<string, unknown> } | null>(null)
  const [newSymbol, setNewSymbol] = useState('')

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

  async function upsertDuration(symbol: string, durationSeconds: number, payoutPercent: string, enabled: boolean) {
    const res = await tryAction(() => api.patch(`/admin/options/markets/${encodeURIComponent(symbol)}/durations`, { durationSeconds, payoutPercent, enabled }))
    if (res.ok) { push('success', `${symbol} ${durationSeconds}s updated.`); marketsRes.refetch() }
    else push('error', res.error)
  }

  return (
    <div className="space-y-6">
      {/* Kill switch + risk limits */}
      <Panel loading={settingsRes.loading} error={settingsRes.error} refetch={settingsRes.refetch}>
        {settingsRes.data && (
          <div className="card p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white">Options Trading — platform-wide kill switch</h3>
                <p className="mt-1 text-sm text-slate-400">Defaults OFF for a brand-new product. Requires step-up re-authentication.</p>
              </div>
              <button
                onClick={() => setStepUp({ kind: 'settings', patch: { tradingEnabled: !settingsRes.data!.tradingEnabled } })}
                className={`rounded-full px-4 py-1.5 text-xs font-bold ${settingsRes.data.tradingEnabled ? 'bg-bull/15 text-bull' : 'bg-bear/15 text-bear'}`}
              >
                {settingsRes.data.tradingEnabled ? 'ON — click to pause' : 'OFF — click to enable'}
              </button>
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-lg border border-gold-500/30 bg-gold-500/10 px-3 py-2 text-xs text-gold-300">
              <FlaskConical className="h-3.5 w-3.5 shrink-0" />
              <span><strong>DEMO / TEST ONLY — NOT AVAILABLE IN PRODUCTION.</strong> Per-trade forced WIN/LOSS/DRAW result simulation (used by automated tests) and the Sandbox Outcome Mode dial below are both rejected by the backend in staging/production regardless of any request — neither is a real customer-outcome control.</span>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <NumberSetting
                label="Max active trades per user"
                value={settingsRes.data.maxActiveTradesPerUser}
                onSave={(v) => setStepUp({ kind: 'settings', patch: { maxActiveTradesPerUser: v } })}
              />
              <NumberSetting
                label="Max exposure per user"
                value={settingsRes.data.maxExposurePerUser ? Number(settingsRes.data.maxExposurePerUser) : null}
                onSave={(v) => setStepUp({ kind: 'settings', patch: { maxExposurePerUser: v != null ? String(v) : undefined } })}
              />
            </div>

            {settingsRes.data.sandboxControlsAvailable && (
              <div className="mt-5 rounded-xl border border-bear/30 bg-bear/5 p-4">
                <p className="text-sm font-bold text-bear">Sandbox Outcome Mode — TEST ONLY</p>
                <p className="mt-1 text-xs text-slate-400">Forces every NORMAL-mode trade's outcome platform-wide, in this environment only. Never affects real Binance execution or real customer funds. Every change is audit logged.</p>
                <div className="mt-3 flex gap-2">
                  {(['RANDOM', 'FORCE_WIN', 'FORCE_LOSS'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setStepUp({ kind: 'settings', patch: { sandboxOutcomeMode: mode } })}
                      className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold ${settingsRes.data!.sandboxOutcomeMode === mode ? 'bg-bear text-white' : 'border border-ink-600 text-slate-400 hover:text-white'}`}
                    >
                      {mode.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Panel>

      {/* Stats */}
      <Panel loading={statsRes.loading} error={statsRes.error} refetch={statsRes.refetch}>
        {statsRes.data && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Active trades" value={statsRes.data.activeTrades} />
            <Stat label="Completed trades" value={statsRes.data.completedTrades} />
            <Stat label="Wins / Losses / Draws" value={`${statsRes.data.wins} / ${statsRes.data.losses} / ${statsRes.data.draws}`} />
            <Stat label="Unresolved trades" value={statsRes.data.unresolvedTrades} />
            <Stat label="Total investment" value={`${Number(statsRes.data.totalInvestment).toLocaleString()} USDT`} />
            <Stat label="Total payouts" value={`${Number(statsRes.data.totalPayouts).toLocaleString()} USDT`} />
          </div>
        )}
      </Panel>

      {/* Unresolved trades */}
      {unresolvedRes.data && unresolvedRes.data.count > 0 && (
        <div className="card overflow-hidden border border-gold-500/30">
          <div className="border-b border-ink-700/60 px-4 py-3">
            <h3 className="font-bold text-gold-300">Unresolved trades ({unresolvedRes.data.count})</h3>
            <p className="text-xs text-slate-500">Expiry price could not be obtained — funds remain reserved, never a fabricated result. The automatic retry sweep re-attempts these continuously.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs uppercase text-slate-500"><th className="px-4 py-2 text-left">Symbol</th><th className="px-4 py-2 text-left">Investment</th><th className="px-4 py-2 text-left">Expired</th><th className="px-4 py-2 text-left">Reason</th></tr></thead>
              <tbody>
                {unresolvedRes.data.trades.map((t: any) => (
                  <tr key={t.id} className="border-t border-ink-700/40">
                    <td className="px-4 py-2.5 text-white">{t.symbol}</td>
                    <td className="px-4 py-2.5 font-mono">{t.investment} {t.currency}</td>
                    <td className="px-4 py-2.5 text-slate-400">{new Date(t.expiryAt).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{t.rejectionReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Asset / duration / payout configuration */}
      <Panel loading={marketsRes.loading} error={marketsRes.error} refetch={marketsRes.refetch}>
        <div className="card p-5">
          <h3 className="font-bold text-white">Add asset</h3>
          <p className="mt-1 text-xs text-slate-500">Symbol must match an existing Markets configuration (Admin &gt; Markets) — e.g. BTC/USDT, XAU/USD.</p>
          <div className="mt-3 flex gap-2">
            <input className="input flex-1" placeholder="BTC/USDT" value={newSymbol} onChange={(e) => setNewSymbol(e.target.value)} />
            <button onClick={createMarket} className="btn-gold px-4"><Plus className="h-4 w-4" /> Add</button>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          {(marketsRes.data ?? []).map((m) => (
            <OptionMarketRow key={m.id} market={m} onToggle={toggleMarket} onUpsertDuration={upsertDuration} />
          ))}
        </div>
      </Panel>

      {stepUp && (
        <StepUpModal
          title="Change options-trading settings"
          description="Platform-wide options controls require step-up re-authentication."
          onConfirm={async ({ reason, confirmPassword, totpCode }) => {
            const res = await tryAction(() => api.patch('/admin/options/settings', { ...stepUp.patch, reason, confirmPassword, totpCode }))
            if (res.ok) { push('success', 'Options settings updated.'); setStepUp(null); settingsRes.refetch() }
            else throw new ApiError(0, res.error, null)
          }}
          onClose={() => setStepUp(null)}
        />
      )}
    </div>
  )
}

function NumberSetting({ label, value, onSave }: { label: string; value: number | null; onSave: (v: number | null) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value != null ? String(value) : '')
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900/60 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      {editing ? (
        <div className="mt-1.5 flex gap-2">
          <input className="input py-1 text-sm" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Unlimited" />
          <button onClick={() => { onSave(draft.trim() === '' ? null : Number(draft)); setEditing(false) }} className="btn-ghost px-2 text-xs">Save</button>
        </div>
      ) : (
        <div className="mt-1.5 flex items-center justify-between">
          <p className="font-mono text-lg font-bold text-white">{value ?? 'Unlimited'}</p>
          <button onClick={() => setEditing(true)} className="btn-ghost px-2 text-xs">Edit</button>
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
  onUpsertDuration: (symbol: string, durationSeconds: number, payoutPercent: string, enabled: boolean) => void
}) {
  const [newDuration, setNewDuration] = useState('')
  const [newPayout, setNewPayout] = useState('')

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-bold text-white">{market.symbol}</p>
          <p className="text-xs text-slate-500">{market.currency} · Min {market.minInvestment} · Max {market.maxInvestment ?? 'Unlimited'}</p>
        </div>
        <button onClick={() => onToggle(market.symbol, !market.enabled)} className={`chip ${market.enabled ? 'border-bull/30 text-bull' : 'border-bear/30 text-bear'}`}>
          Options: {market.enabled ? 'ENABLED' : 'DISABLED'}
        </button>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-slate-500"><th className="py-1 text-left">Duration</th><th className="py-1 text-left">Payout %</th><th className="py-1 text-left">Status</th><th className="py-1 text-right">Action</th></tr></thead>
          <tbody>
            {market.durations.map((d) => (
              <DurationRow key={d.id} symbol={market.symbol} duration={d} onUpsertDuration={onUpsertDuration} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input className="input w-24 py-1 text-xs" placeholder="Seconds" value={newDuration} onChange={(e) => setNewDuration(e.target.value)} />
        <input className="input w-24 py-1 text-xs" placeholder="Payout %" value={newPayout} onChange={(e) => setNewPayout(e.target.value)} />
        <button
          onClick={() => { if (newDuration && newPayout) { onUpsertDuration(market.symbol, Number(newDuration), newPayout, true); setNewDuration(''); setNewPayout('') } }}
          className="btn-ghost px-3 text-xs"
        >
          <Plus className="h-3.5 w-3.5" /> Add duration
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
  onUpsertDuration: (symbol: string, durationSeconds: number, payoutPercent: string, enabled: boolean) => void
}) {
  const [payout, setPayout] = useState(duration.payoutPercent)
  return (
    <tr className="border-t border-ink-700/40">
      <td className="py-1.5 font-mono text-white">{duration.durationSeconds}s</td>
      <td className="py-1.5">
        <input className="input w-20 py-1 text-xs" value={payout} onChange={(e) => setPayout(e.target.value)} onBlur={() => { if (payout !== duration.payoutPercent) onUpsertDuration(symbol, duration.durationSeconds, payout, duration.enabled) }} />
      </td>
      <td className="py-1.5">
        <span className={duration.enabled ? 'text-bull' : 'text-bear'}>{duration.enabled ? 'Enabled' : 'Disabled'}</span>
      </td>
      <td className="py-1.5 text-right">
        <button onClick={() => onUpsertDuration(symbol, duration.durationSeconds, duration.payoutPercent, !duration.enabled)} className="btn-ghost px-2 py-0.5 text-[11px]">
          {duration.enabled ? 'Disable' : 'Enable'}
        </button>
      </td>
    </tr>
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
  'crypto_deposits.read', 'crypto_deposits.control',
  'withdrawals.read', 'withdrawals.review', 'trading.read', 'trading.control', 'markets.read',
  'markets.control', 'options.read', 'options.control', 'ledger.read', 'ledger.adjust', 'audit.read',
  'platform.read', 'platform.control', 'admins.read', 'admins.manage',
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

// ---- CMS ------------------------------------------------------------------------

type CmsSubTab = 'pages' | 'announcements' | 'faqs' | 'media'

function CmsTab() {
  const [sub, setSub] = useState<CmsSubTab>('pages')
  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {(['pages', 'announcements', 'faqs', 'media'] as const).map((s) => (
          <button key={s} onClick={() => setSub(s)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${sub === s ? 'bg-gold-500/15 text-gold-300' : 'text-slate-400 hover:bg-ink-800'}`}>{s}</button>
        ))}
      </div>
      {sub === 'pages' && <CmsPagesTab />}
      {sub === 'announcements' && <CmsAnnouncementsTab />}
      {sub === 'faqs' && <CmsFaqsTab />}
      {sub === 'media' && <CmsMediaTab />}
    </div>
  )
}

function CmsPagesTab() {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<CmsPage[]>('/admin/cms/pages')
  const [creating, setCreating] = useState(false)
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  async function create() {
    const res = await tryAction(() => api.post('/admin/cms/pages', { slug, title, sections: [] }))
    if (res.ok) { push('success', 'Draft page created.'); setSlug(''); setTitle(''); setCreating(false); refetch() }
    else push('error', res.error)
  }

  async function act(id: string, action: 'publish' | 'unpublish' | 'archive') {
    const res = await tryAction(() => api.post(`/admin/cms/pages/${id}/${action}`, { reason: `${action} via admin panel` }))
    if (res.ok) { push('success', `Page ${action}ed.`); refetch() }
    else push('error', res.error)
  }

  return (
    <Panel loading={loading} error={error} refetch={refetch}>
      <div className="mb-3 flex justify-end">
        <button onClick={() => setCreating((c) => !c)} className="btn-ghost text-xs"><Plus className="h-3.5 w-3.5" /> New page</button>
      </div>
      {creating && (
        <div className="card mb-3 flex flex-wrap items-end gap-2 p-4">
          <div className="flex-1 min-w-[140px]"><label className="label">Slug</label><input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="about" /></div>
          <div className="flex-1 min-w-[140px]"><label className="label">Title</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="About Us" /></div>
          <button onClick={create} className="btn-gold text-xs">Create draft</button>
        </div>
      )}
      {(data ?? []).length === 0 ? <EmptyState icon={FileText} title="No pages yet" /> : (
        <div className="card overflow-hidden">
          {(data ?? []).map((p) => (
            <div key={p.id} className="border-b border-ink-700/40 last:border-b-0">
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-white">{p.title} <span className="text-xs text-slate-500">/{p.slug}</span></p>
                  <span className={`chip ${p.status === 'PUBLISHED' ? 'border-bull/30 text-bull' : p.status === 'ARCHIVED' ? 'border-bear/30 text-bear' : ''}`}>{p.status}</span>
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => setEditingId(editingId === p.id ? null : p.id)} className="btn-ghost text-xs">{editingId === p.id ? 'Close' : 'Edit content'}</button>
                  {p.status !== 'PUBLISHED' && <button onClick={() => act(p.id, 'publish')} className="btn-ghost text-xs">Publish</button>}
                  {p.status === 'PUBLISHED' && <button onClick={() => act(p.id, 'unpublish')} className="btn-ghost text-xs">Unpublish</button>}
                  {p.status !== 'ARCHIVED' && <button onClick={() => act(p.id, 'archive')} className="btn-ghost text-xs">Archive</button>}
                </div>
              </div>
              {editingId === p.id && <CmsPageSectionsEditor page={p} onSaved={() => { setEditingId(null); refetch() }} />}
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

// Sections editor kept deliberately simple — a raw-JSON textarea, not a
// visual page builder (out of scope for this phase; see the Phase 4 report's
// Part 9/scope notes). Server-side validation (validateSections in
// cms.validation.ts) is still the real safety net — this only saves whatever
// valid JSON the admin submits, and surfaces the backend's rejection message
// verbatim if it's invalid (unsafe link, unknown section type, etc).
function CmsPageSectionsEditor({ page, onSaved }: { page: CmsPage; onSaved: () => void }) {
  const { push } = useToast()
  const [text, setText] = useState(() => JSON.stringify(page.sections, null, 2))
  const [saving, setSaving] = useState(false)

  async function save() {
    let sections: unknown
    try { sections = JSON.parse(text) } catch { push('error', 'Not valid JSON.'); return }
    setSaving(true)
    const res = await tryAction(() => api.patch(`/admin/cms/pages/${page.id}`, { sections, reason: 'Edited content via admin panel' }))
    setSaving(false)
    if (res.ok) { push('success', 'Page content saved.'); onSaved() }
    else push('error', res.error)
  }

  return (
    <div className="border-t border-ink-700/60 bg-ink-900/40 p-4">
      <p className="mb-2 text-xs text-slate-500">Sections JSON — array of {'{ type, fields }'} blocks. Allowed types: hero, feature, stats, cta, text, trust, faq_teaser, footer.</p>
      <textarea className="input min-h-[220px] font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <button onClick={save} disabled={saving} className="btn-gold mt-2 text-xs">{saving ? 'Saving…' : 'Save content'}</button>
    </div>
  )
}

function CmsAnnouncementsTab() {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<CmsAnnouncement[]>('/admin/cms/announcements')
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  async function create() {
    const res = await tryAction(() => api.post('/admin/cms/announcements', { title, body }))
    if (res.ok) { push('success', 'Announcement created.'); setTitle(''); setBody(''); setCreating(false); refetch() }
    else push('error', res.error)
  }

  async function act(id: string, action: 'publish' | 'unpublish' | 'archive') {
    const res = await tryAction(() => api.post(`/admin/cms/announcements/${id}/${action}`, { reason: `${action} via admin panel` }))
    if (res.ok) { push('success', `Announcement ${action}ed.`); refetch() }
    else push('error', res.error)
  }

  return (
    <Panel loading={loading} error={error} refetch={refetch}>
      <div className="mb-3 flex justify-end">
        <button onClick={() => setCreating((c) => !c)} className="btn-ghost text-xs"><Plus className="h-3.5 w-3.5" /> New announcement</button>
      </div>
      {creating && (
        <div className="card mb-3 space-y-2 p-4">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
          <textarea className="input" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Body" rows={2} />
          <button onClick={create} className="btn-gold text-xs">Create draft</button>
        </div>
      )}
      {(data ?? []).length === 0 ? <EmptyState icon={FileText} title="No announcements yet" /> : (
        <div className="card overflow-hidden">
          {(data ?? []).map((a) => (
            <div key={a.id} className="flex items-center justify-between border-b border-ink-700/40 px-4 py-3 last:border-b-0">
              <div>
                <p className="text-sm font-semibold text-white">{a.title}</p>
                <p className="text-xs text-slate-500">{a.priority} · {a.loggedInOnly ? 'Logged-in only' : 'Public'} · <span className={a.status === 'PUBLISHED' ? 'text-bull' : ''}>{a.status}</span></p>
              </div>
              <div className="flex gap-1.5">
                {a.status !== 'PUBLISHED' && <button onClick={() => act(a.id, 'publish')} className="btn-ghost text-xs">Publish</button>}
                {a.status === 'PUBLISHED' && <button onClick={() => act(a.id, 'unpublish')} className="btn-ghost text-xs">Unpublish</button>}
                {a.status !== 'ARCHIVED' && <button onClick={() => act(a.id, 'archive')} className="btn-ghost text-xs">Archive</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

function CmsFaqsTab() {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<CmsFaq[]>('/admin/cms/faqs')
  const [creating, setCreating] = useState(false)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')

  async function create() {
    const res = await tryAction(() => api.post('/admin/cms/faqs', { question, answer }))
    if (res.ok) { push('success', 'FAQ created.'); setQuestion(''); setAnswer(''); setCreating(false); refetch() }
    else push('error', res.error)
  }

  async function act(id: string, action: 'publish' | 'archive') {
    const res = await tryAction(() => api.post(`/admin/cms/faqs/${id}/${action}`, { reason: `${action} via admin panel` }))
    if (res.ok) { push('success', `FAQ ${action}d.`); refetch() }
    else push('error', res.error)
  }

  return (
    <Panel loading={loading} error={error} refetch={refetch}>
      <div className="mb-3 flex justify-end">
        <button onClick={() => setCreating((c) => !c)} className="btn-ghost text-xs"><Plus className="h-3.5 w-3.5" /> New FAQ</button>
      </div>
      {creating && (
        <div className="card mb-3 space-y-2 p-4">
          <input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Question" />
          <textarea className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Answer" rows={2} />
          <button onClick={create} className="btn-gold text-xs">Create draft</button>
        </div>
      )}
      {(data ?? []).length === 0 ? <EmptyState icon={FileText} title="No FAQs yet" /> : (
        <div className="card overflow-hidden">
          {(data ?? []).map((f) => (
            <div key={f.id} className="flex items-center justify-between border-b border-ink-700/40 px-4 py-3 last:border-b-0">
              <div>
                <p className="text-sm font-semibold text-white">{f.question}</p>
                <span className={`chip ${f.status === 'PUBLISHED' ? 'border-bull/30 text-bull' : ''}`}>{f.status}</span>
              </div>
              <div className="flex gap-1.5">
                {f.status !== 'PUBLISHED' && <button onClick={() => act(f.id, 'publish')} className="btn-ghost text-xs">Publish</button>}
                {f.status !== 'ARCHIVED' && <button onClick={() => act(f.id, 'archive')} className="btn-ghost text-xs">Archive</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

// ---- CMS Media (Phase 4, Part 9) --------------------------------------------------

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const MEDIA_KINDS = ['IMAGE', 'DOCUMENT', 'LOGO', 'BANNER'] as const

function CmsMediaTab() {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<CmsMedia[]>('/admin/cms/media')
  const [file, setFile] = useState<File | null>(null)
  const [kind, setKind] = useState<(typeof MEDIA_KINDS)[number]>('IMAGE')
  const [uploading, setUploading] = useState(false)

  async function upload() {
    if (!file) { push('error', 'Choose a file first.'); return }
    const form = new FormData()
    form.append('file', file)
    form.append('kind', kind)
    setUploading(true)
    try {
      await api.postForm('/admin/cms/media', form)
      push('success', 'Media uploaded.')
      setFile(null)
      refetch()
    } catch (e) {
      push('error', e instanceof ApiError ? e.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
  }

  async function remove(id: string) {
    const res = await tryAction(() => api.del(`/admin/cms/media/${id}`))
    if (res.ok) { push('success', 'Media deleted.'); refetch() }
    else push('error', res.error) // e.g. "referenced by published page X" — surfaced verbatim, deletion correctly blocked
  }

  function copyReference(id: string) {
    const url = mediaUrl(id)
    navigator.clipboard?.writeText(url).then(
      () => push('success', 'Reference copied — paste it into a section\'s image/link field.'),
      () => push('error', 'Could not copy to clipboard.'),
    )
  }

  return (
    <Panel loading={loading} error={error} refetch={refetch}>
      <div className="card mb-3 flex flex-wrap items-end gap-2 p-4">
        <div className="flex-1 min-w-[200px]">
          <label className="label">File (PNG, JPEG, WEBP, GIF, or PDF — max 5MB)</label>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="input" />
        </div>
        <div>
          <label className="label">Kind</label>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {MEDIA_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <button onClick={upload} disabled={uploading} className="btn-gold text-xs"><Upload className="h-3.5 w-3.5" /> {uploading ? 'Uploading…' : 'Upload'}</button>
      </div>

      {(data ?? []).length === 0 ? <EmptyState icon={Upload} title="No media uploaded yet" /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(data ?? []).map((m) => (
            <div key={m.id} className="card overflow-hidden p-3">
              {m.mimeType.startsWith('image/') ? (
                <img src={mediaUrl(m.id)} alt={m.filename} className="mb-2 h-32 w-full rounded-lg object-cover" />
              ) : (
                <div className="mb-2 flex h-32 w-full items-center justify-center rounded-lg bg-ink-800 text-slate-500"><FileText className="h-8 w-8" /></div>
              )}
              <p className="truncate text-sm font-medium text-white" title={m.filename}>{m.filename}</p>
              <p className="text-xs text-slate-500">{m.kind} · {formatBytes(m.size)} · {new Date(m.createdAt).toLocaleDateString()}</p>
              <div className="mt-2 flex gap-1.5">
                <button onClick={() => copyReference(m.id)} className="btn-ghost flex-1 text-xs"><Copy className="h-3.5 w-3.5" /> Copy reference</button>
                <button onClick={() => remove(m.id)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-bear/30 text-bear hover:bg-bear/10"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

// ---- Support -----------------------------------------------------------------------

const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'WAITING_INTERNAL', 'RESOLVED', 'CLOSED'] as const
const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const

// Filtering/search (Part 14) is done client-side over the already-fetched
// list — at this platform's scale that's simpler and just as fast as a
// round-trip per filter change, and avoids widening the admin ticket-list
// API with a combinatorial set of query params for a demo-scale dataset.
function SupportTab() {
  const { error, loading, data, refetch } = useAdmin<SupportTicket[]>('/admin/support/tickets')
  const [selected, setSelected] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const [category, setCategory] = useState('')
  const [agent, setAgent] = useState('')
  const [q, setQ] = useState('')

  const categories = Array.from(new Set((data ?? []).map((t) => t.category?.name).filter(Boolean))) as string[]
  const agents = Array.from(new Map((data ?? []).filter((t) => t.assignedAgent).map((t) => [t.assignedAgent!.id, t.assignedAgent!])).values())

  const filtered = (data ?? []).filter((t) => {
    if (status && t.status !== status) return false
    if (priority && t.priority !== priority) return false
    if (category && t.category?.name !== category) return false
    if (agent === '__unassigned__' && t.assignedAgentId) return false
    if (agent && agent !== '__unassigned__' && t.assignedAgentId !== agent) return false
    if (q && !`${t.subject} ${t.user?.email ?? ''}`.toLowerCase().includes(q.toLowerCase())) return false
    return true
  })

  return (
    <Panel loading={loading} error={error} refetch={refetch}>
      <div className="card mb-3 flex flex-wrap items-end gap-2 p-3">
        <div className="min-w-[160px] flex-1">
          <label className="label">Search</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Subject or customer email" />
          </div>
        </div>
        <div><label className="label">Status</label><select className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{TICKET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
        <div><label className="label">Priority</label><select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">All</option>{TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
        <div><label className="label">Category</label><select className="input" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
        <div><label className="label">Agent</label><select className="input" value={agent} onChange={(e) => setAgent(e.target.value)}><option value="">All</option><option value="__unassigned__">Unassigned</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.fullName}</option>)}</select></div>
      </div>

      {filtered.length === 0 ? <EmptyState icon={Headset} title="No support tickets match these filters" /> : (
        <div className="card overflow-hidden">
          {filtered.map((t) => (
            <div key={t.id}>
              <button onClick={() => setSelected(selected === t.id ? null : t.id)} className="flex w-full items-center justify-between border-b border-ink-700/40 px-4 py-3 text-left last:border-b-0 hover:bg-ink-800/40">
                <div>
                  <p className="text-sm font-semibold text-white">{t.subject}</p>
                  <p className="text-xs text-slate-500">{t.user?.email} · {t.category?.name} · {t.priority} · {t.assignedAgent ? `Assigned to ${t.assignedAgent.fullName}` : 'Unassigned'}</p>
                </div>
                <span className="chip">{t.status}</span>
              </button>
              {selected === t.id && <SupportTicketDetail ticketId={t.id} onChanged={refetch} />}
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

function SupportTicketDetail({ ticketId, onChanged }: { ticketId: string; onChanged: () => void }) {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<SupportTicket>(`/admin/support/tickets/${ticketId}`)
  const [reply, setReply] = useState('')
  const [internal, setInternal] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [agents, setAgents] = useState<{ id: string; fullName: string; email: string }[] | null>(null)

  useEffect(() => {
    // Not every viewer has support.tickets.assign — a 403 here just means
    // "don't show the assign control", not a page-level error.
    api.get<{ id: string; fullName: string; email: string }[]>('/admin/support/agents').then(setAgents).catch(() => setAgents(null))
  }, [])

  async function sendReply() {
    if (!reply.trim() && !file) return
    setSending(true)
    let res: { ok: true; data: unknown } | { ok: false; error: string }
    if (file) {
      const form = new FormData()
      form.append('file', file)
      if (reply.trim()) form.append('body', reply)
      form.append('visibility', internal ? 'INTERNAL' : 'PUBLIC')
      res = await tryAction(() => api.postForm(`/admin/support/tickets/${ticketId}/attachments`, form))
    } else {
      res = await tryAction(() => api.post(`/admin/support/tickets/${ticketId}/messages`, { body: reply, visibility: internal ? 'INTERNAL' : 'PUBLIC' }))
    }
    setSending(false)
    if (res.ok) { setReply(''); setFile(null); refetch(); onChanged() }
    else push('error', res.error)
  }

  async function setStatus(status: string) {
    const res = await tryAction(() => api.patch(`/admin/support/tickets/${ticketId}/status`, { status, reason: `Set to ${status} via admin panel` }))
    if (res.ok) { push('success', `Status set to ${status}.`); refetch(); onChanged() }
    else push('error', res.error)
  }

  async function assign(agentId: string) {
    if (!agentId) return
    const res = await tryAction(() => api.post(`/admin/support/tickets/${ticketId}/assign`, { agentId, reason: 'Assigned via admin panel' }))
    if (res.ok) { push('success', 'Ticket assigned.'); refetch(); onChanged() }
    else push('error', res.error)
  }

  if (loading) return <div className="border-t border-ink-700/40 p-4 text-xs text-slate-500">Loading…</div>
  if (error || !data) return <div className="border-t border-ink-700/40 p-4 text-xs text-bear">{error?.message ?? 'Could not load ticket.'}</div>

  return (
    <div className="border-t border-ink-700/60 bg-ink-900/40 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(['IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED'] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)} className="btn-ghost text-[11px]">{s}</button>
        ))}
        {agents && (
          <select className="input ml-auto w-auto text-[11px]" value={data.assignedAgentId ?? ''} onChange={(e) => assign(e.target.value)}>
            <option value="">Unassigned — assign to…</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.fullName}</option>)}
          </select>
        )}
      </div>
      <div className="max-h-64 space-y-2 overflow-y-auto">
        {(data.messages ?? []).map((m) => (
          <div key={m.id} className={`rounded-lg px-3 py-2 text-xs ${m.visibility === 'INTERNAL' ? 'border border-gold-500/30 bg-gold-500/5 text-gold-200' : 'bg-ink-800 text-slate-200'}`}>
            <p className="mb-0.5 font-semibold text-white">{m.author?.fullName ?? 'User'} {m.visibility === 'INTERNAL' && <span className="text-gold-400">(internal)</span>}</p>
            {m.body}
            {(m.attachments ?? []).map((a) => (
              <a key={a.id} href={attachmentUrl(a.id)} className="mt-1 flex items-center gap-1.5 text-ocean-300 hover:text-ocean-200" download>
                <Paperclip className="h-3 w-3" /> {a.filename}
              </a>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        <div className="flex items-center gap-2">
          <input className="input flex-1 text-sm" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…" onKeyDown={(e) => e.key === 'Enter' && sendReply()} />
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal</label>
          <button onClick={sendReply} disabled={sending} className="btn-gold text-xs">{sending ? 'Sending…' : 'Send'}</button>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <Paperclip className="h-3.5 w-3.5" />
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[11px]" />
        </div>
      </div>
    </div>
  )
}
