// Settings — platform-wide kill switches (ported unchanged from the old
// PlatformTab) plus spot market configuration (ported unchanged from the
// old MarketsTab), combined into one route since both are system-wide
// configuration concerns. CMS and Audit Logs remain real, working pages —
// linked here rather than dropped from the dashboard grid, so neither is
// hidden behind an obscure/undiscoverable path.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, ScrollText, Settings as SettingsIcon } from 'lucide-react'
import type { MarketConfig, PlatformSettings } from '../../types'
import { api, ApiError } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { StepUpModal } from '../../components/StepUpModal'
import { AdminPageHeader, AdminPanel, AdminSection, AdminTable, AdminTableHead, AdminStatusBadge, useAdmin, tryAction } from '../../components/admin'

interface Overview { platform: PlatformSettings }

export function SettingsPage() {
  return (
    <div>
      <AdminPageHeader icon={SettingsIcon} title="Settings" description="Platform-wide kill switches and spot market configuration." back={{ to: '/admin' }} />
      <div className="space-y-6">
        <PlatformKillSwitches />
        <SpotMarkets />

        <AdminSection title="More" description="Other configuration pages, kept accessible here rather than added to the main dashboard grid.">
          <div className="flex flex-wrap gap-2">
            <Link to="/admin/cms" className="admin-btn-secondary"><FileText className="h-3.5 w-3.5" /> CMS — Pages, announcements, FAQs, media</Link>
            <Link to="/admin/audit-logs" className="admin-btn-secondary"><ScrollText className="h-3.5 w-3.5" /> Audit Logs</Link>
          </div>
        </AdminSection>
      </div>
    </div>
  )
}

function PlatformKillSwitches() {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<Overview>('/admin/overview')
  const [pending, setPending] = useState<{ key: keyof PlatformSettings; next: boolean } | null>(null)

  return (
    <AdminPanel loading={loading} error={error} refetch={refetch}>
      {data && (
        <div className="admin-card p-6">
          <h3 className="font-bold text-admin-text">Platform-wide kill switches</h3>
          <p className="mt-1 text-sm text-admin-muted">Changes here take effect immediately and are enforced by the backend, not just hidden in the UI. Requires step-up re-authentication.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {(['tradingEnabled', 'depositsEnabled', 'withdrawalsEnabled', 'registrationsEnabled'] as const).map((k) => (
              <div key={k} className="admin-surface flex items-center justify-between px-4 py-3">
                <span className="text-sm font-medium capitalize text-admin-text">{k.replace('Enabled', '')}</span>
                <button onClick={() => setPending({ key: k, next: !data.platform[k] })} className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${data.platform[k] ? 'bg-bull/15 text-bull' : 'bg-bear/15 text-bear'}`}>
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
    </AdminPanel>
  )
}

function SpotMarkets() {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<MarketConfig[]>('/markets/config')

  async function toggle(symbol: string, patch: Partial<{ tradingEnabled: boolean; maintenanceMode: boolean }>) {
    const res = await tryAction(() => api.patch(`/admin/markets/${encodeURIComponent(symbol)}`, { ...patch, reason: 'Toggled via admin panel' }))
    if (res.ok) { push('success', `${symbol} updated.`); refetch() }
    else push('error', res.error)
  }

  return (
    <div>
      <h3 className="mb-3 font-bold text-admin-text">Spot markets</h3>
      <AdminPanel loading={loading} error={error} refetch={refetch}>
        <AdminTable>
          <AdminTableHead columns={[
            { label: 'Symbol' }, { label: 'Type' }, { label: 'Provider' }, { label: 'Provider Symbol' }, { label: 'Data Source' },
            { label: 'Listed' }, { label: 'Trading' }, { label: 'Maintenance' }, { label: 'Actions', align: 'right' },
          ]} />
          <tbody>
            {(data ?? []).map((m) => (
              <tr key={m.symbol} className="border-b border-admin-border/60 hover:bg-admin-surface/50">
                <td className="px-4 py-2.5 font-medium text-admin-text">{m.symbol} <span className="text-xs text-admin-mutedDim">{m.displayName}</span></td>
                <td className="px-4 py-2.5 text-xs text-admin-muted">{m.marketType}</td>
                <td className="px-4 py-2.5 text-xs text-admin-muted">{m.provider ?? <span className="text-bear">none</span>}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-admin-mutedDim">{m.providerSymbol ?? '—'}</td>
                <td className="px-4 py-2.5"><AdminStatusBadge tone={m.dataSource === 'LIVE' ? 'success' : 'info'}>{m.dataSource}</AdminStatusBadge></td>
                <td className="px-4 py-2.5">{m.enabled ? <span className="text-bull">Yes</span> : <span className="text-admin-mutedDim">No</span>}</td>
                <td className="px-4 py-2.5">{m.tradingEnabled ? <span className="text-bull">Enabled</span> : <span className="text-bear">Disabled</span>}</td>
                <td className="px-4 py-2.5">{m.maintenanceMode ? <span className="text-admin-gold">Yes</span> : <span className="text-admin-mutedDim">No</span>}</td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex justify-end gap-1.5">
                    <button onClick={() => toggle(m.symbol, { tradingEnabled: !m.tradingEnabled })} className="admin-btn-secondary px-2 py-1.5 text-[11px]">{m.tradingEnabled ? 'Disable Trading' : 'Enable Trading'}</button>
                    <button onClick={() => toggle(m.symbol, { maintenanceMode: !m.maintenanceMode })} className="admin-btn-secondary px-2 py-1.5 text-[11px]">{m.maintenanceMode ? 'Clear Maintenance' : 'Set Maintenance'}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </AdminTable>
      </AdminPanel>
    </div>
  )
}
