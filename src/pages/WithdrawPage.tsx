import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../store/auth'
import { useCashBalance, useWithdrawals, submitWithdrawal, pushLocalNotification } from '../store/useStore'
import { useCryptoAssets } from '../store/useCryptoDeposits'
import { useToast } from '../components/Toast'
import { AssetIcon } from '../components/AssetIcon'
import { CryptoNetworkSelector } from '../components/deposits/CryptoNetworkSelector'
import { ArrowRight, AlertTriangle, Clock, CheckCircle2, XCircle } from 'lucide-react'

// USDT-only, matching the Deposit page's direction (Deposit page comment,
// same reasoning): this platform's crypto funding flow is USDT-only, not a
// multi-method (bank/card) picker. Network choice is real, backend-driven
// config (GET /crypto-deposits/assets — the same source the Deposit page
// uses), never a hardcoded list; if USDT has no networks configured yet,
// CryptoNetworkSelector's own honest "not configured" state is shown rather
// than a fabricated one. Withdrawals have no dedicated network field on the
// backend (only amount/currency/destination — see
// backend/src/withdrawals/dto/create-withdrawal.dto.ts), so the chosen
// network is folded into the free-text destination, same as this page
// already did with a method label before this change.
const USDT_SYMBOL = 'USDT'

export function WithdrawPage() {
  const { user } = useAuth()
  const { balance, refetch: refetchBalance } = useCashBalance('USDT')
  const { assets } = useCryptoAssets()
  const { withdrawals, refetch: refetchWithdrawals } = useWithdrawals()
  const { push } = useToast()
  const [networkCode, setNetworkCode] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [address, setAddress] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const usdt = useMemo(() => assets.find((a) => a.symbol === USDT_SYMBOL) ?? null, [assets])

  useEffect(() => {
    if (usdt && usdt.networks.length > 0 && !usdt.networks.some((n) => n.networkCode === networkCode)) {
      setNetworkCode(usdt.networks[0].networkCode)
    }
    if (!usdt || usdt.networks.length === 0) setNetworkCode(null)
  }, [usdt, networkCode])

  const cash = balance ? Number(balance.cash) : 0
  const amt = parseFloat(amount) || 0
  const selectedNetwork = usdt?.networks.find((n) => n.networkCode === networkCode) ?? null

  async function submit() {
    if (!Number.isFinite(amt) || amt <= 0) { push('error', 'Enter a valid withdrawal amount.'); return }
    if (!address.trim()) { push('error', 'Enter your destination address.'); return }
    setSubmitting(true)
    const label = selectedNetwork ? `USDT (${selectedNetwork.networkName})` : 'USDT'
    const res = await submitWithdrawal({ amount: amt, currency: 'USDT', destination: `${label}: ${address.trim()}` })
    setSubmitting(false)
    if (res.ok) {
      if (res.data.status === 'REJECTED') {
        push('error', 'Withdrawal rejected — insufficient available balance.')
      } else {
        push('success', `Withdrawal of ${amt.toFixed(2)} USDT submitted for review.`)
        if (user) pushLocalNotification(user.id, { title: 'Withdrawal requested', body: `Your withdrawal of ${amt.toFixed(2)} USDT is pending review.`, kind: 'withdrawal' })
      }
      setAmount('')
      setAddress('')
      refetchWithdrawals()
      refetchBalance()
    } else {
      push('error', res.error)
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Form */}
        <div className="card p-6 lg:col-span-2">
          <h3 className="font-bold text-white">Withdraw funds</h3>

          <div className="mt-4">
            <label className="label">Asset</label>
            <div className="flex items-center gap-3 rounded-xl border border-ink-600 bg-ink-900 px-4 py-3">
              <AssetIcon symbol={USDT_SYMBOL} size={28} />
              <span className="font-semibold text-white">USDT — Tether</span>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <CryptoNetworkSelector networks={usdt?.networks ?? []} selected={networkCode} onSelect={setNetworkCode} />
            <div>
              <label className="label">Destination address</label>
              <input className="input font-mono text-sm" placeholder="Your USDT wallet address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div>
              <label className="label">Amount (USDT)</label>
              <input className="input" type="number" min="1" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="flex items-center justify-between rounded-xl bg-ink-800 p-4 text-sm">
              <span className="text-slate-500">Available balance</span>
              <span className="font-mono font-bold text-white">{balance ? `${cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT` : '—'}</span>
            </div>
            <button onClick={() => setAmount(String(cash))} className="text-xs text-ocean-400 hover:text-ocean-300">Withdraw max</button>
            <div className="rounded-xl border border-gold-500/20 bg-gold-500/5 p-4 text-xs text-slate-400">
              <p className="flex items-center gap-1.5 font-medium text-gold-300"><Clock className="h-3.5 w-3.5" /> Processing time</p>
              <p className="mt-1">Withdrawals are reviewed by our team and typically processed within 24 hours. You will receive a notification when your withdrawal is approved or rejected.</p>
            </div>
            <button onClick={submit} disabled={submitting} className="btn-gold w-full py-3">{submitting ? 'Submitting…' : 'Submit withdrawal request'} <ArrowRight className="h-4 w-4" /></button>
          </div>
        </div>

        {/* Status flow */}
        <div className="card p-6">
          <h3 className="font-bold text-white">Withdrawal status</h3>
          <div className="mt-4 space-y-3">
            {withdrawals.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">No withdrawals yet. Your withdrawal history will appear here.</p>
            ) : (
              withdrawals.slice(0, 10).map((w) => (
                <div key={w.id} className="rounded-xl border border-ink-600 bg-ink-900 p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-white">{Number(w.amount).toFixed(2)} {w.currency}</span>
                    <StatusPill status={w.status} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{new Date(w.createdAt).toLocaleString()}</p>
                  <p className="mt-1 truncate font-mono text-xs text-slate-600">{w.destination}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Warning */}
      <div className="flex items-start gap-3 rounded-xl border border-bear/20 bg-bear/5 p-4 text-sm text-slate-400">
        <AlertTriangle className="h-5 w-5 shrink-0 text-bear" />
        <p>EDGETRADE is a fictional demonstration platform. No real funds are involved. Withdrawal requests are simulated and processed by the admin panel for demonstration purposes.</p>
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  if (status === 'COMPLETED' || status === 'APPROVED') return <span className="flex items-center gap-1 rounded-full bg-bull/15 px-2.5 py-1 text-xs font-semibold text-bull"><CheckCircle2 className="h-3.5 w-3.5" /> {status === 'APPROVED' ? 'Approved' : 'Completed'}</span>
  if (status === 'PENDING' || status === 'REVIEW' || status === 'PROCESSING') return <span className="flex items-center gap-1 rounded-full bg-gold-500/15 px-2.5 py-1 text-xs font-semibold text-gold-300"><Clock className="h-3.5 w-3.5" /> {status === 'PENDING' ? 'Pending' : status === 'REVIEW' ? 'In review' : 'Processing'}</span>
  if (status === 'REJECTED') return <span className="flex items-center gap-1 rounded-full bg-bear/15 px-2.5 py-1 text-xs font-semibold text-bear"><XCircle className="h-3.5 w-3.5" /> Rejected</span>
  return <span className="chip">{status}</span>
}
