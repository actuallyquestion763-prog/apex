// Deposit Management — reviews individual deposit REQUESTS (confirm/reject).
// Distinct from Deposit Wallet (DepositWalletPage.tsx), which configures
// what's OFFERED. Logic unchanged — table presentation restyled to match
// the reference layout: plain-text status/slip-link instead of pill
// controls, full date+time, comma-grouped amounts, and a terminal-state
// label in the Action column instead of leaving it blank.
import { ArrowDownToLine, Inbox } from 'lucide-react'
import type { Deposit, DepositStatus } from '../../types'
import { api } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { AdminPageHeader, AdminPanel, AdminTable, AdminTableHead, statusTone, useAdmin, tryAction, AdminEmptyState } from '../../components/admin'

interface AdminDeposit extends Deposit { user: { id: string; email: string; fullName: string } }

// Plain-text color per status tone — the same semantic tone AdminStatusBadge
// uses elsewhere (statusTone()), just rendered as colored text instead of a
// pill, matching this table's reference layout.
const STATUS_TEXT_CLASS: Record<ReturnType<typeof statusTone>, string> = {
  success: 'text-bull',
  danger: 'text-bear',
  warning: 'text-admin-gold',
  info: 'text-ocean-400',
  neutral: 'text-admin-muted',
}

// What the Action column shows once a deposit is no longer actionable —
// terminal states never revert to Approve/Reject buttons, but the reference
// layout still labels what happened rather than leaving the cell blank.
const TERMINAL_ACTION_LABEL: Partial<Record<DepositStatus, string>> = {
  CONFIRMED: 'Completed',
  FAILED: 'Rejected',
  REVERSED: 'Reversed',
}

export function DepositsPage() {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<AdminDeposit[]>('/admin/deposits')

  async function act(id: string, action: 'confirm' | 'reject') {
    const res = await tryAction(() => api.post(`/admin/deposits/${id}/${action}`, { reason: `${action === 'confirm' ? 'Confirmed' : 'Rejected'} via admin panel` }))
    if (res.ok) { push('success', `Deposit ${action === 'confirm' ? 'confirmed' : 'rejected'}.`); refetch() }
    else push('error', res.error)
  }

  return (
    <div>
      <AdminPageHeader icon={ArrowDownToLine} title="Deposit Management" description="Review and confirm pending customer deposit requests." back={{ to: '/admin' }} />
      <AdminPanel loading={loading} error={error} refetch={refetch}>
        {(data ?? []).length === 0 ? <AdminEmptyState icon={Inbox} title="No deposits" /> : (
          <AdminTable>
            <AdminTableHead columns={[
              { label: 'ID' }, { label: 'User' }, { label: 'Coin' }, { label: 'Network' }, { label: 'Amount', align: 'right' },
              { label: 'Slip' }, { label: 'Status' }, { label: 'Date' }, { label: 'Action', align: 'right' },
            ]} />
            <tbody>
              {(data ?? []).map((d) => (
                <tr key={d.id} className="border-b border-admin-border/60 hover:bg-admin-surface/50">
                  <td className="px-4 py-2.5 font-mono text-xs text-admin-mutedDim">#{d.id.slice(0, 6).toUpperCase()}</td>
                  <td className="px-4 py-2.5 text-admin-text">{d.user.email}</td>
                  <td className="px-4 py-2.5 text-admin-muted">{d.cryptoAssetSymbol ?? d.method}</td>
                  <td className="px-4 py-2.5 text-admin-mutedDim" title={d.receivingAddress ?? undefined}>{d.networkCode ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-admin-text">{Number(d.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} {d.currency}</td>
                  <td className="px-4 py-2.5">
                    {d.proofFilename ? (
                      <a href={`/api/admin/deposits/${d.id}/proof`} target="_blank" rel="noreferrer" className="text-ocean-400 hover:underline">View Slip</a>
                    ) : (
                      <span className="text-xs text-admin-mutedDim/60">—</span>
                    )}
                  </td>
                  <td className={`px-4 py-2.5 font-medium ${STATUS_TEXT_CLASS[statusTone(d.status)]}`}>{d.status.toLowerCase()}</td>
                  <td className="px-4 py-2.5 text-admin-mutedDim">{new Date(d.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right">
                    {(d.status === 'PENDING' || d.status === 'PROCESSING') ? (
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => act(d.id, 'confirm')} className="admin-btn-success px-2.5 py-1.5 text-[11px]">Approve</button>
                        <button onClick={() => act(d.id, 'reject')} className="admin-btn-danger px-2.5 py-1.5 text-[11px]">Reject</button>
                      </div>
                    ) : (
                      <span className="text-xs text-admin-mutedDim">{TERMINAL_ACTION_LABEL[d.status] ?? '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        )}
      </AdminPanel>
    </div>
  )
}
