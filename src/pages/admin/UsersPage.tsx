// Admin Users — search, balance, and detail view. Wraps the backend's
// listUsers(q)/getUserDetail endpoints. Role/status change logic ported
// unchanged from the old UsersTab. Balance CREDIT/DEBIT is intentionally
// NOT done from this page — see WalletAdjustmentPage.tsx, its own
// dedicated route; "Adjust" here links there with the user preselected.
import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { Lock, RefreshCw, Unlock, Users as UsersIcon, Wallet } from 'lucide-react'
import type { AssetBalance, Deposit, Withdrawal } from '../../types'
import { api, ApiError } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { StepUpModal } from '../../components/StepUpModal'
import { AdminPageHeader, AdminPanel, AdminTable, AdminTableHead, AdminStatusBadge, statusTone, AdminSearchInput, useAdmin, tryAction, AdminEmptyState } from '../../components/admin'

// The API already returns referralCode on every admin/users row (toPublicUser
// spreads the full User minus passwordHash) — used below as "Member ID", the
// platform's real user-facing identifier. There is no phone field anywhere
// in this system (checked prisma/schema.prisma and src/types.ts) — Phone
// always shows "—" rather than inventing data.
interface AdminUserRow {
  id: string; email: string; fullName: string; role: string; status: string; kycStatus: string; usdtBalance: string; referralCode: string
}
interface UserDetail {
  user: AdminUserRow
  accountId: string | null
  balances: AssetBalance[]
  recentDeposits: Deposit[]
  recentWithdrawals: Withdrawal[]
}

export function UsersPage() {
  const { push } = useToast()
  const [q, setQ] = useState('')
  const [submittedQ, setSubmittedQ] = useState('')
  const { data, loading, error, refetch } = useAdmin<AdminUserRow[]>(`/admin/users${submittedQ ? `?q=${encodeURIComponent(submittedQ)}` : ''}`)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [stepUp, setStepUp] = useState<{ kind: 'role'; user: AdminUserRow; role: string } | null>(null)

  async function applyStatus(user: AdminUserRow, status: string) {
    const res = await tryAction(() => api.patch(`/admin/users/${user.id}/status`, { status, reason: `Status changed to ${status} via admin panel` }))
    if (res.ok) { push('success', `${user.email} is now ${status}.`); refetch() }
    else push('error', res.error)
  }

  return (
    <div>
      <AdminPageHeader
        icon={UsersIcon}
        title="Users"
        description="Search customers, view balances, and manage account status."
        back={{ to: '/admin' }}
        actions={<span className="admin-badge border-admin-gold/30 bg-admin-gold/10 text-admin-gold">Total Users: {(data ?? []).length}</span>}
      />

      <div className="mb-4 flex gap-2">
        <AdminSearchInput className="max-w-sm flex-1" value={q} onChange={setQ} placeholder="Search by email, name, or user ID" />
        <button onClick={() => setSubmittedQ(q.trim())} className="admin-btn-primary px-4">Search</button>
        {submittedQ && <button onClick={() => { setQ(''); setSubmittedQ('') }} className="admin-btn-secondary px-4">Clear</button>}
        <button onClick={refetch} className="admin-btn-secondary px-3" aria-label="Refresh"><RefreshCw className="h-3.5 w-3.5" /></button>
      </div>

      <AdminPanel loading={loading} error={error} refetch={refetch}>
        {(data ?? []).length === 0 ? <AdminEmptyState icon={UsersIcon} title="No users match this search" /> : (
          <AdminTable>
            <AdminTableHead columns={[
              { label: 'UID' }, { label: 'Member ID' }, { label: 'Name' }, { label: 'Phone' }, { label: 'Email' },
              { label: 'Balance', align: 'right' }, { label: 'Action', align: 'right' },
            ]} />
            <tbody>
              {(data ?? []).map((u) => (
                <Fragment key={u.id}>
                  <tr className="border-b border-admin-border/60 hover:bg-admin-surface/50">
                    <td className="px-4 py-2.5 font-mono text-xs text-admin-mutedDim">{u.id.slice(0, 8)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-admin-muted">{u.referralCode}</td>
                    <td className="px-4 py-2.5 text-admin-text">{u.fullName}</td>
                    <td className="px-4 py-2.5 text-admin-mutedDim">—</td>
                    <td className="px-4 py-2.5 text-admin-muted">{u.email}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-admin-text">{Number(u.usdtBalance).toLocaleString()} USDT</td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button onClick={() => setExpandedId(expandedId === u.id ? null : u.id)} className="admin-btn-success px-2.5 py-1.5 text-[11px]">{expandedId === u.id ? 'Hide' : 'View'}</button>
                        <Link to={`/admin/wallet-adjustment?u=${encodeURIComponent(u.email)}`} className="admin-btn-info px-2.5 py-1.5 text-[11px]"><Wallet className="h-3 w-3" /> Adjust</Link>
                        {u.status === 'ACTIVE' ? (
                          <button onClick={() => applyStatus(u, 'SUSPENDED')} className="admin-btn-danger px-2.5 py-1.5 text-[11px]"><Lock className="h-3 w-3" /> Suspend</button>
                        ) : (
                          <button onClick={() => applyStatus(u, 'ACTIVE')} className="admin-btn-success px-2.5 py-1.5 text-[11px]"><Unlock className="h-3 w-3" /> Activate</button>
                        )}
                        <button onClick={() => setStepUp({ kind: 'role', user: u, role: u.role === 'USER' ? 'ADMIN' : 'USER' })} className="admin-btn-secondary px-2.5 py-1.5 text-[11px]">{u.role === 'USER' ? 'Promote' : 'Demote'}</button>
                      </div>
                    </td>
                  </tr>
                  {expandedId === u.id && (
                    <tr className="border-b border-admin-border/60 bg-admin-bg2">
                      <td colSpan={7} className="px-4 py-4"><UserDetailPanel userId={u.id} row={u} /></td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </AdminTable>
        )}
      </AdminPanel>

      {stepUp?.kind === 'role' && (
        <StepUpModal
          title={`Change role to ${stepUp.role}`}
          description={`This changes ${stepUp.user.email}'s role. Role changes require SUPER_ADMIN + step-up re-authentication.`}
          onConfirm={async ({ reason, confirmPassword }) => {
            const res = await tryAction(() => api.patch(`/admin/users/${stepUp.user.id}/role`, { role: stepUp.role, reason, confirmPassword }))
            if (res.ok) { push('success', 'Role updated.'); setStepUp(null); refetch() }
            else throw new ApiError(0, res.error, null)
          }}
          onClose={() => setStepUp(null)}
        />
      )}
    </div>
  )
}

function UserDetailPanel({ userId, row }: { userId: string; row: AdminUserRow }) {
  const { data, loading, error, refetch } = useAdmin<UserDetail>(`/admin/users/${userId}`)
  if (loading) return <p className="text-xs text-admin-mutedDim">Loading…</p>
  if (error || !data) return <p className="text-xs text-bear">{error?.message ?? 'Could not load user detail.'}</p>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <AdminStatusBadge tone="info">{row.role}</AdminStatusBadge>
        <AdminStatusBadge tone={statusTone(row.status)}>{row.status}</AdminStatusBadge>
        <AdminStatusBadge tone={statusTone(row.kycStatus)}>KYC: {row.kycStatus}</AdminStatusBadge>
      </div>
      <div>
        <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-admin-mutedDim">Balances</h4>
        {data.balances.length === 0 ? (
          <p className="text-xs text-admin-mutedDim">No non-zero balances.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {data.balances.map((b) => (
              <div key={b.currency} className="admin-surface px-3 py-2">
                <p className="text-[11px] text-admin-mutedDim">{b.currency}</p>
                <p className="font-mono text-sm font-bold text-admin-text">{Number(b.total).toLocaleString()}</p>
                <p className="text-[10px] text-admin-mutedDim/70">cash {Number(b.cash).toLocaleString()} · reserved {Number(b.reserved).toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-admin-mutedDim">Recent deposits</h4>
          {data.recentDeposits.length === 0 ? <p className="text-xs text-admin-mutedDim">None yet.</p> : (
            <div className="space-y-1.5">
              {data.recentDeposits.map((d) => (
                <div key={d.id} className="admin-surface flex items-center justify-between px-3 py-1.5 text-xs">
                  <span className="text-admin-muted">{new Date(d.createdAt).toLocaleDateString()} · {d.method}</span>
                  <span className="font-mono text-admin-text">{Number(d.amount).toFixed(2)} {d.currency}</span>
                  <span className="text-admin-mutedDim">{d.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-admin-mutedDim">Recent withdrawals</h4>
          {data.recentWithdrawals.length === 0 ? <p className="text-xs text-admin-mutedDim">None yet.</p> : (
            <div className="space-y-1.5">
              {data.recentWithdrawals.map((w) => (
                <div key={w.id} className="admin-surface flex items-center justify-between px-3 py-1.5 text-xs">
                  <span className="text-admin-muted">{new Date(w.createdAt).toLocaleDateString()}</span>
                  <span className="font-mono text-admin-text">{Number(w.amount).toFixed(2)} {w.currency}</span>
                  <span className="text-admin-mutedDim">{w.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <button onClick={refetch} className="text-[11px] text-admin-mutedDim hover:text-admin-muted">Refresh</button>
    </div>
  )
}
