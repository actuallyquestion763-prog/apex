// Manual Wallet Adjustment — a dedicated page for the existing, safe
// financial-adjustment backend (POST /admin/financial-adjustment): balance
// precondition on debit, Postgres advisory lock, step-up re-authentication,
// full audit trail. This page only ever calls that same endpoint — it does
// not bypass balance validation, authorization, or audit logging. Search
// reuses the same listUsers(q) endpoint as the Users page; arriving from
// there via "Adjust" preselects the user through the `u` query param.
//
// The platform has no phone field on User (checked prisma/schema.prisma and
// src/types.ts before building this) — the Phone column below always shows
// "—" rather than inventing data that doesn't exist.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Banknote } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { StepUpModal } from '../../components/StepUpModal'
import { AdminPageHeader, AdminCard, AdminTable, AdminTableHead, AdminSearchInput, tryAction } from '../../components/admin'

interface AdminUserRow {
  id: string; email: string; fullName: string; role: string; status: string; kycStatus: string; usdtBalance: string
}

const CURRENCIES = ['USDT', 'USD', 'BTC', 'ETH', 'USDC', 'BNB'] as const

export function WalletAdjustmentPage() {
  const { push } = useToast()
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('u') ?? '')
  const [results, setResults] = useState<AdminUserRow[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<AdminUserRow | null>(null)
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>('USDT')
  const [direction, setDirection] = useState<'CREDIT' | 'DEBIT'>('CREDIT')
  const [amount, setAmount] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null)

  async function search(query: string) {
    setSearching(true)
    const res = await tryAction(() => api.get<AdminUserRow[]>(`/admin/users${query ? `?q=${encodeURIComponent(query)}` : ''}`))
    setSearching(false)
    if (res.ok) {
      setResults(res.data)
      if (res.data.length === 1) setSelected(res.data[0])
    } else push('error', res.error)
  }

  // Auto-run the search once if we arrived with a preselected user email
  // (e.g. from the Users page's "Adjust" link).
  useEffect(() => {
    const initial = params.get('u')
    if (initial?.trim()) search(initial.trim())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openConfirm(dir: 'CREDIT' | 'DEBIT') {
    const amt = parseFloat(amount)
    if (!selected) { push('error', 'Select a user first.'); return }
    if (!Number.isFinite(amt) || amt <= 0) { push('error', 'Enter a valid positive amount.'); return }
    setDirection(dir)
    setIdempotencyKey(crypto.randomUUID())
    setConfirming(true)
  }

  return (
    <div>
      <AdminPageHeader icon={Banknote} title="Manual Wallet Adjust" description="Credit or debit a customer balance with a real, audited ledger entry." back={{ to: '/admin' }} />

      <AdminCard>
        <div className="flex gap-2">
          <AdminSearchInput className="flex-1" value={q} onChange={setQ} placeholder="Search by member ID, phone, email, or name" />
          <button onClick={() => search(q.trim())} disabled={searching} className="admin-btn-primary px-5">{searching ? 'Searching…' : 'Search'}</button>
        </div>
      </AdminCard>

      {results && (
        <div className="mt-4">
          {results.length === 0 ? (
            <p className="text-sm text-admin-mutedDim">No users match this search.</p>
          ) : (
            <AdminTable>
              <AdminTableHead columns={[{ label: 'ID' }, { label: 'Name' }, { label: 'Phone' }, { label: 'Email' }, { label: 'Balance', align: 'right' }]} />
              <tbody>
                {results.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => setSelected(u)}
                    className={`cursor-pointer border-b border-admin-border/60 transition ${selected?.id === u.id ? 'bg-admin-gold/10' : 'hover:bg-admin-surface/50'}`}
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-admin-mutedDim">{u.id.slice(0, 8)}</td>
                    <td className="px-4 py-2.5 text-admin-text">{u.fullName}</td>
                    <td className="px-4 py-2.5 text-admin-mutedDim">—</td>
                    <td className="px-4 py-2.5 text-admin-muted">{u.email}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-admin-text">{Number(u.usdtBalance).toLocaleString()} USDT</td>
                  </tr>
                ))}
              </tbody>
            </AdminTable>
          )}
        </div>
      )}

      {selected && (
        <AdminCard className="mt-4">
          <h3 className="font-bold text-admin-text">Selected User</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <Field label="ID" value={selected.id.slice(0, 8)} mono />
            <Field label="Name" value={selected.fullName} />
            <Field label="Phone" value="—" />
            <Field label="Current Balance" value={`${Number(selected.usdtBalance).toLocaleString()} USDT`} mono />
          </div>

          <div className="mt-4 flex gap-2">
            <select className="admin-input w-28" value={currency} onChange={(e) => setCurrency(e.target.value as typeof currency)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input className="admin-input flex-1" type="number" min="0" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>

          <div className="mt-3 flex gap-3">
            <button onClick={() => openConfirm('CREDIT')} className="admin-btn-success flex-1 py-3 text-sm">Add Money</button>
            <button onClick={() => openConfirm('DEBIT')} className="admin-btn-danger flex-1 py-3 text-sm">Remove Money</button>
          </div>
          <p className="mt-2 text-[11px] text-admin-mutedDim/70">Debits are rejected by the backend if they would take the balance below zero — this page cannot override that.</p>
        </AdminCard>
      )}

      {confirming && selected && (
        <StepUpModal
          title={`${direction === 'CREDIT' ? 'Credit' : 'Debit'} ${amount} ${currency} — ${selected.email}`}
          description="Financial adjustments post a real, auditable ledger transaction and require re-authentication. This is not a client-side balance editor."
          onConfirm={async ({ reason, confirmPassword }) => {
            const res = await tryAction(() => api.post('/admin/financial-adjustment', {
              userId: selected.id, amount, direction, currency, reason, confirmPassword, idempotencyKey,
            }))
            if (res.ok) {
              push('success', 'Ledger adjustment posted.')
              setConfirming(false)
              setAmount('')
              search(q.trim())
            } else {
              throw new ApiError(0, res.error, null)
            }
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-admin-mutedDim">{label}</p>
      <p className={`mt-0.5 text-sm text-admin-text ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}
