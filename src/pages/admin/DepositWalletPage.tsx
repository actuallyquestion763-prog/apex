// Deposit Wallet — crypto asset/network/receiving-address configuration.
// SPECIAL REQUIREMENT: every piece of this page's behavior — QR upload/
// replace/remove, delete, enable/disable, address/network/coin/display-
// order editing — calls the exact same endpoints with the exact same
// payload shapes as the previously-verified implementation. This pass only
// restructures the presentation (a single Coin/Network/Address/Order/QR/
// Enable form + a flat "Deposit Wallet List" of cards, per the reference)
// instead of a nested per-asset table; no API call, DTO field, or
// StepUpModal flow was changed.
import { useState } from 'react'
import { Bitcoin, Pencil, Plus, Power, PowerOff, Trash2 } from 'lucide-react'
import { api, ApiError, cryptoDepositQrUrl } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { StepUpModal } from '../../components/StepUpModal'
import { AdminPageHeader, AdminCard, AdminPanel, AdminStatusBadge, useAdmin, tryAction, AdminEmptyState } from '../../components/admin'

interface CryptoNetworkAdminRow { id: string; networkCode: string; networkName: string; enabled: boolean; receivingAddress: string; minimumDeposit: string | null; sortOrder: number; hasQr: boolean }
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

const BLANK_FORM = { symbol: '', networkCode: '', networkName: '', address: '', minimum: '', sortOrder: '', enabled: true, qrFile: null as File | null, removeQr: false }

export function DepositWalletPage() {
  const { push } = useToast()
  const { data, loading, error, refetch } = useAdmin<CryptoAssetAdminRow[]>('/admin/crypto-deposits/assets')
  const [selectedSymbol, setSelectedSymbol] = useState('')
  const [form, setForm] = useState(BLANK_FORM)
  const [editingCode, setEditingCode] = useState<string | null>(null)
  const [stepUp, setStepUp] = useState<{ symbol: string; patch: Record<string, unknown>; qrFile?: File | null } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ symbol: string; networkCode: string } | null>(null)

  const assets = data ?? []
  const configuredSymbols = new Set(assets.map((a) => a.symbol))
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

  function startNew() {
    setEditingCode(null)
    setForm({ ...BLANK_FORM, symbol: assets[0]?.symbol ?? '' })
  }

  function startEdit(assetSymbol: string, n: CryptoNetworkAdminRow) {
    setEditingCode(n.networkCode)
    setForm({
      symbol: assetSymbol,
      networkCode: n.networkCode,
      networkName: n.networkName,
      address: n.receivingAddress,
      minimum: n.minimumDeposit ?? '',
      sortOrder: String(n.sortOrder),
      enabled: n.enabled,
      qrFile: null,
      removeQr: false,
    })
  }

  function saveWallet() {
    if (!form.symbol || !form.networkCode.trim() || !form.networkName.trim() || !form.address.trim()) {
      push('error', 'Coin, network code, network name, and wallet address are required.')
      return
    }
    const patch: Record<string, unknown> = {
      networkCode: form.networkCode.trim().toUpperCase(),
      networkName: form.networkName.trim(),
      receivingAddress: form.address.trim(),
      minimumDeposit: form.minimum.trim() || undefined,
      sortOrder: form.sortOrder.trim() || undefined,
      enabled: form.enabled,
    }
    if (form.removeQr) patch.removeQr = true
    setStepUp({ symbol: form.symbol, patch, qrFile: form.qrFile })
  }

  function requestQrRemovalFromList(assetSymbol: string, n: CryptoNetworkAdminRow) {
    setStepUp({
      symbol: assetSymbol,
      patch: { networkCode: n.networkCode, networkName: n.networkName, receivingAddress: n.receivingAddress, minimumDeposit: n.minimumDeposit ?? undefined, sortOrder: n.sortOrder, removeQr: true },
    })
  }

  const editingAsset = assets.find((a) => a.symbol === form.symbol)
  const editingNetwork = editingCode ? editingAsset?.networks.find((n) => n.networkCode === editingCode) : undefined

  return (
    <div>
      <AdminPageHeader icon={Bitcoin} title="Deposit Wallet" description="Crypto assets, receiving addresses, QR codes, and network configuration." back={{ to: '/admin' }} />

      <div className="space-y-6">
        <div className="rounded-lg border border-admin-gold/30 bg-admin-gold/10 px-4 py-3 text-xs text-admin-gold">
          Receiving-address changes require step-up re-authentication (your current password) — this is the address real customer deposits get sent to.
        </div>

        <AdminPanel loading={loading} error={error} refetch={refetch}>
          <AdminCard>
            <h3 className="font-bold text-admin-text">Add crypto asset</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <select
                className="admin-input flex-1"
                value={selectedSymbol}
                onChange={(e) => setSelectedSymbol(e.target.value)}
                aria-label="Select cryptocurrency"
              >
                <option value="">Select cryptocurrency</option>
                {availableCryptoAssets.map((c) => (
                  <option key={c.symbol} value={c.symbol}>{c.symbol} — {c.name}</option>
                ))}
              </select>
              <button onClick={createAsset} disabled={!selectedSymbol} className="admin-btn-primary px-4">
                <Plus className="h-4 w-4" /> Add
              </button>
            </div>
            {availableCryptoAssets.length === 0 && (
              <p className="mt-2 text-xs text-admin-mutedDim">All 5 supported cryptocurrencies are already configured.</p>
            )}
          </AdminCard>

          <AdminCard className="mt-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-admin-text">{editingCode ? `Edit wallet — ${editingCode}` : 'Add wallet'}</h3>
              <button onClick={startNew} className="admin-btn-info">New</button>
            </div>
            {assets.length === 0 ? (
              <p className="mt-3 text-xs text-admin-mutedDim">Add a crypto asset above first, then configure its receiving address here.</p>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="admin-label">Coin</label>
                    <select className="admin-input" value={form.symbol} onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value }))}>
                      <option value="">Select coin</option>
                      {assets.map((a) => <option key={a.symbol} value={a.symbol}>{a.symbol} — {a.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="admin-label">Network</label>
                    <div className="flex gap-2">
                      <input className="admin-input" placeholder="Code (TRC20)" value={form.networkCode} onChange={(e) => setForm((f) => ({ ...f, networkCode: e.target.value }))} />
                      <input className="admin-input" placeholder="Name (Tron)" value={form.networkName} onChange={(e) => setForm((f) => ({ ...f, networkName: e.target.value }))} />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="admin-label">Wallet Address</label>
                  <input className="admin-input font-mono" placeholder="Receiving address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="admin-label">Minimum deposit (optional)</label>
                    <input className="admin-input" value={form.minimum} onChange={(e) => setForm((f) => ({ ...f, minimum: e.target.value }))} />
                  </div>
                  <div>
                    <label className="admin-label">Display Order</label>
                    <input className="admin-input" type="number" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} />
                  </div>
                </div>

                <div className="flex flex-wrap items-end gap-4">
                  <div className="flex-1 min-w-[220px]">
                    <label className="admin-label">{editingNetwork?.hasQr ? 'Replace QR Code' : 'Upload QR Code'}</label>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="text-xs text-admin-muted"
                      onChange={(e) => setForm((f) => ({ ...f, qrFile: e.target.files?.[0] ?? null }))}
                    />
                  </div>
                  {editingNetwork?.hasQr && (
                    <label className="flex items-center gap-1.5 pb-2 text-xs text-admin-mutedDim">
                      <input type="checkbox" checked={form.removeQr} onChange={(e) => setForm((f) => ({ ...f, removeQr: e.target.checked }))} />
                      Remove existing QR
                    </label>
                  )}
                  <label className="flex items-center gap-1.5 pb-2 text-xs text-admin-muted">
                    <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />
                    Enable Wallet
                  </label>
                </div>

                <button onClick={saveWallet} className="admin-btn-success"><Plus className="h-3.5 w-3.5" /> Save</button>
              </div>
            )}
          </AdminCard>

          <div className="mt-6">
            <h3 className="mb-3 font-bold text-admin-text">Deposit Wallet List</h3>
            {assets.every((a) => a.networks.length === 0) ? (
              <AdminEmptyState icon={Bitcoin} title="No wallets configured yet" hint="Add a crypto asset, then configure its receiving address above." />
            ) : (
              <div className="space-y-2">
                {assets.filter((a) => a.networks.length > 0).flatMap((asset) => asset.networks.map((n) => (
                  <div key={n.id} className="admin-card flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                    {n.hasQr ? (
                      <a href={cryptoDepositQrUrl(asset.symbol, n.networkCode)} target="_blank" rel="noreferrer" title="Open full size" className="shrink-0">
                        <img src={cryptoDepositQrUrl(asset.symbol, n.networkCode)} alt={`${n.networkCode} QR code`} className="h-12 w-12 rounded-lg border border-admin-border object-cover" />
                      </a>
                    ) : (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-admin-border bg-admin-surface text-admin-mutedDim">
                        <Bitcoin className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-admin-text">{asset.symbol}</span>
                        <button onClick={() => toggleAsset(asset.symbol, !asset.enabled)} className={`admin-badge ${asset.enabled ? 'border-bull/30 bg-bull/10 text-bull' : 'border-bear/30 bg-bear/10 text-bear'}`}>
                          {asset.enabled ? <Power className="h-3 w-3" /> : <PowerOff className="h-3 w-3" />} {asset.enabled ? 'ENABLED' : 'DISABLED'}
                        </button>
                        <span className="text-admin-mutedDim">{n.networkName} ({n.networkCode})</span>
                      </div>
                      <p className="mt-0.5 truncate font-mono text-xs text-admin-muted" title={n.receivingAddress}>{n.receivingAddress}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <AdminStatusBadge tone={n.enabled ? 'success' : 'danger'}>{n.enabled ? 'ACTIVE' : 'DISABLED'}</AdminStatusBadge>
                        <span className="text-[11px] text-admin-mutedDim">Order {n.sortOrder}</span>
                        {n.minimumDeposit && <span className="text-[11px] text-admin-mutedDim">Min {n.minimumDeposit}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      <button onClick={() => startEdit(asset.symbol, n)} className="admin-btn-info px-2.5 py-1.5 text-[11px]"><Pencil className="h-3 w-3" /> Edit</button>
                      {n.hasQr && (
                        <button onClick={() => requestQrRemovalFromList(asset.symbol, n)} className="admin-btn-secondary px-2.5 py-1.5 text-[11px]">Remove QR</button>
                      )}
                      <button onClick={() => setDeleteTarget({ symbol: asset.symbol, networkCode: n.networkCode })} className="admin-btn-danger px-2.5 py-1.5 text-[11px]"><Trash2 className="h-3 w-3" /> Delete</button>
                    </div>
                  </div>
                )))}
              </div>
            )}
          </div>
        </AdminPanel>

        {stepUp && (
          <StepUpModal
            title={`Update ${stepUp.symbol} receiving address`}
            description="Changing a crypto receiving address is a fund-safety-critical operation and requires step-up re-authentication. New deposits will use this address immediately; existing deposits keep their own historical snapshot."
            onConfirm={async ({ reason, confirmPassword }) => {
              // multipart/form-data — the backend accepts an optional QR image
              // ("qr") alongside these fields on this same endpoint.
              const form2 = new FormData()
              for (const [key, value] of Object.entries(stepUp.patch)) {
                if (value === undefined) continue
                form2.append(key, String(value))
              }
              form2.append('reason', reason)
              form2.append('confirmPassword', confirmPassword)
              if (stepUp.qrFile) form2.append('qr', stepUp.qrFile)
              const res = await tryAction(() => api.patchForm(`/admin/crypto-deposits/assets/${encodeURIComponent(stepUp.symbol)}/networks`, form2))
              if (res.ok) { push('success', 'Receiving address updated.'); setStepUp(null); setForm(BLANK_FORM); setEditingCode(null); refetch() }
              else throw new ApiError(0, res.error, null)
            }}
            onClose={() => setStepUp(null)}
          />
        )}

        {deleteTarget && (
          <StepUpModal
            title={`Delete ${deleteTarget.networkCode} network`}
            description={`This removes the ${deleteTarget.networkCode} receiving-address configuration for ${deleteTarget.symbol}. Existing deposit records keep their own historical snapshot and are unaffected — only future deposits lose this option.`}
            onConfirm={async ({ reason, confirmPassword }) => {
              const res = await tryAction(() =>
                api.del(`/admin/crypto-deposits/assets/${encodeURIComponent(deleteTarget.symbol)}/networks/${encodeURIComponent(deleteTarget.networkCode)}`, { reason, confirmPassword }),
              )
              if (res.ok) { push('success', 'Network removed.'); setDeleteTarget(null); refetch() }
              else throw new ApiError(0, res.error, null)
            }}
            onClose={() => setDeleteTarget(null)}
          />
        )}
      </div>
    </div>
  )
}
