// Deposit Management — reviews individual deposit REQUESTS (confirm/reject).
// Distinct from Deposit Wallet (DepositWalletPage.tsx), which configures
// what's OFFERED. Logic unchanged — only table styling updated.
import { ArrowDownToLine, Inbox } from 'lucide-react'
import type { Deposit } from '../../types'
import { api } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { AdminPageHeader, AdminPanel, AdminTable, AdminTableHead, AdminStatusBadge, statusTone, useAdmin, tryAction, AdminEmptyState } from '../../components/admin'

interface AdminDeposit extends Deposit { user: { id: string; email: string; fullName: string } }

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
                  <td className="px-4 py-2.5 font-mono text-xs text-admin-mutedDim">{d.id.slice(0, 8)}</td>
                  <td className="px-4 py-2.5 text-admin-text">{d.user.email}</td>
                  <td className="px-4 py-2.5 text-admin-muted">{d.cryptoAssetSymbol ?? d.method}</td>
                  <td className="px-4 py-2.5 text-admin-mutedDim" title={d.receivingAddress ?? undefined}>{d.networkCode ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-admin-text">{Number(d.amount).toFixed(2)} {d.currency}</td>
                  <td className="px-4 py-2.5">
                    {d.proofFilename ? (
                      <a href={`/api/admin/deposits/${d.id}/proof`} target="_blank" rel="noreferrer" className="admin-btn-info inline-flex px-2.5 py-1 text-[11px]">View</a>
                    ) : (
                      <span className="text-xs text-admin-mutedDim/60">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5"><AdminStatusBadge tone={statusTone(d.status)}>{d.status}</AdminStatusBadge></td>
                  <td className="px-4 py-2.5 text-admin-mutedDim">{new Date(d.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5 text-right">
                    {(d.status === 'PENDING' || d.status === 'PROCESSING') && (
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => act(d.id, 'confirm')} className="admin-btn-success px-2.5 py-1.5 text-[11px]">Approve</button>
                        <button onClick={() => act(d.id, 'reject')} className="admin-btn-danger px-2.5 py-1.5 text-[11px]">Reject</button>
                      </div>
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
