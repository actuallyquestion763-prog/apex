// Withdrawal Management — ported unchanged from the old WithdrawalsTab. QR
// column encodes the withdrawal's own real `destination` address, client-
// side, via the same real QR encoder used elsewhere (src/components/QrCode)
// — never a fabricated pattern. Withdrawals don't carry a per-network code
// the way crypto deposits do, so Network honestly shows "—" rather than
// inventing one.
import { useState } from 'react'
import { ArrowUpFromLine, Copy, Inbox } from 'lucide-react'
import type { Withdrawal } from '../../types'
import { api, ApiError } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { StepUpModal } from '../../components/StepUpModal'
import { QrCode } from '../../components/QrCode'
import { AdminPageHeader, AdminPanel, AdminTable, AdminTableHead, AdminStatusBadge, statusTone, useAdmin, tryAction, AdminEmptyState } from '../../components/admin'

interface AdminWithdrawal extends Withdrawal { user: { id: string; email: string; fullName: string } }

export function WithdrawalsPage() {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<AdminWithdrawal[]>('/admin/withdrawals')
  const [approving, setApproving] = useState<AdminWithdrawal | null>(null)
  const [qrTarget, setQrTarget] = useState<AdminWithdrawal | null>(null)

  async function reject(id: string) {
    const res = await tryAction(() => api.post(`/admin/withdrawals/${id}/reject`, { reason: 'Rejected via admin panel' }))
    if (res.ok) { push('success', 'Withdrawal rejected.'); refetch() }
    else push('error', res.error)
  }

  function copyAddress(address: string) {
    navigator.clipboard?.writeText(address).then(
      () => push('success', 'Address copied.'),
      () => push('error', 'Could not copy to clipboard.'),
    )
  }

  return (
    <div>
      <AdminPageHeader icon={ArrowUpFromLine} title="Withdrawal Management" description="Approve or reject pending customer withdrawal requests." back={{ to: '/admin' }} />
      <AdminPanel loading={loading} error={error} refetch={refetch}>
        {(data ?? []).length === 0 ? <AdminEmptyState icon={Inbox} title="No withdrawals" /> : (
          <AdminTable>
            <AdminTableHead columns={[
              { label: 'ID' }, { label: 'UID' }, { label: 'Name' }, { label: 'Coin' }, { label: 'Network' }, { label: 'Amount', align: 'right' },
              { label: 'Address' }, { label: 'QR' }, { label: 'Status' }, { label: 'Date' }, { label: 'Action', align: 'right' },
            ]} />
            <tbody>
              {(data ?? []).map((w) => (
                <tr key={w.id} className="border-b border-admin-border/60 hover:bg-admin-surface/50">
                  <td className="px-4 py-2.5 font-mono text-xs text-admin-mutedDim">{w.id.slice(0, 8)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-admin-mutedDim">{w.userId.slice(0, 8)}</td>
                  <td className="px-4 py-2.5 text-admin-text">{w.user.fullName}</td>
                  <td className="px-4 py-2.5 text-admin-muted">{w.currency}</td>
                  <td className="px-4 py-2.5 text-admin-mutedDim">—</td>
                  <td className="px-4 py-2.5 text-right font-mono text-admin-text">{w.currency === 'USD' ? `$${Number(w.amount).toFixed(2)}` : `${Number(w.amount).toFixed(2)} ${w.currency}`}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex max-w-[180px] items-center gap-1.5">
                      <span className="truncate font-mono text-xs text-admin-muted" title={w.destination}>{w.destination}</span>
                      <button onClick={() => copyAddress(w.destination)} className="shrink-0 text-admin-mutedDim hover:text-admin-text" aria-label="Copy address" title="Copy address"><Copy className="h-3 w-3" /></button>
                    </div>
                  </td>
                  <td className="px-4 py-2.5"><button onClick={() => setQrTarget(w)} className="admin-btn-info px-2.5 py-1 text-[11px]">QR</button></td>
                  <td className="px-4 py-2.5"><AdminStatusBadge tone={statusTone(w.status)}>{w.status}</AdminStatusBadge></td>
                  <td className="px-4 py-2.5 text-admin-mutedDim">{new Date(w.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5 text-right">
                    {(w.status === 'PENDING' || w.status === 'REVIEW') && (
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => setApproving(w)} className="admin-btn-success px-2.5 py-1.5 text-[11px]">Approve</button>
                        <button onClick={() => reject(w.id)} className="admin-btn-danger px-2.5 py-1.5 text-[11px]">Reject</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        )}
      </AdminPanel>

      {qrTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setQrTarget(null)}>
          <div className="admin-card p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 text-sm font-bold text-admin-text">Destination address</p>
            <QrCode value={qrTarget.destination} size={200} />
            <p className="mt-3 max-w-[200px] break-all font-mono text-xs text-admin-muted">{qrTarget.destination}</p>
            <button onClick={() => setQrTarget(null)} className="admin-btn-secondary mt-4">Close</button>
          </div>
        </div>
      )}

      {approving && (
        <StepUpModal
          title={`Approve withdrawal — ${approving.currency === 'USD' ? `$${Number(approving.amount).toFixed(2)}` : `${Number(approving.amount).toFixed(2)} ${approving.currency}`}`}
          description={`Withdrawal approval for ${approving.user.email} requires step-up re-authentication.`}
          onConfirm={async ({ reason, confirmPassword, totpCode }) => {
            const res = await tryAction(() => api.post(`/admin/withdrawals/${approving.id}/approve`, { reason, confirmPassword, totpCode }))
            if (res.ok) { push('success', 'Withdrawal approved.'); setApproving(null); refetch() }
            else throw new ApiError(0, res.error, null)
          }}
          onClose={() => setApproving(null)}
        />
      )}
    </div>
  )
}
