// Audit Logs — read-only, immutable at the database level. Ported unchanged
// from the old AuditTab. Not a primary dashboard card — linked from
// Settings so it stays reachable without cluttering the main grid.
import { ScrollText } from 'lucide-react'
import { AdminPageHeader, AdminPanel, AdminTable, AdminTableHead, useAdmin, AdminEmptyState } from '../../components/admin'

interface AuditRow {
  id: string; actorId: string | null; action: string; targetType: string | null; targetId: string | null
  previousState: unknown; newState: unknown; reason: string | null; createdAt: string
}

export function AuditPage() {
  const { data, loading, error, refetch } = useAdmin<AuditRow[]>('/admin/audit-logs?limit=200')
  return (
    <div>
      <AdminPageHeader icon={ScrollText} title="Audit Logs" description="Read-only, immutable log of every sensitive admin action." back={{ to: '/admin/settings' }} />
      <AdminPanel loading={loading} error={error} refetch={refetch}>
        {(data ?? []).length === 0 ? <AdminEmptyState icon={ScrollText} title="No audit log entries" /> : (
          <AdminTable>
            <AdminTableHead columns={[{ label: 'Time' }, { label: 'Action' }, { label: 'Target' }, { label: 'Reason' }]} />
            <tbody>
              {(data ?? []).map((row) => (
                <tr key={row.id} className="border-b border-admin-border/60">
                  <td className="px-4 py-2.5 text-admin-muted">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-admin-text">{row.action}</td>
                  <td className="px-4 py-2.5 text-admin-muted">{row.targetType ? `${row.targetType}${row.targetId ? ` · ${row.targetId.slice(0, 8)}` : ''}` : '—'}</td>
                  <td className="px-4 py-2.5 text-admin-mutedDim">{row.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        )}
      </AdminPanel>
      <p className="mt-3 text-[11px] text-admin-mutedDim/70">This log is immutable at the database level (see backend/prisma/migrations/…_audit_log_immutability).</p>
    </div>
  )
}
