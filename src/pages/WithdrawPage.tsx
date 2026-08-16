import { useState } from 'react'
import { useAuth } from '../store/auth'
import { useAccountSummary, useWithdrawals, submitWithdrawal, pushLocalNotification } from '../store/useStore'
import { useToast } from '../components/Toast'
import { Bitcoin, Landmark, CreditCard, ArrowRight, AlertTriangle, Clock, CheckCircle2, XCircle } from 'lucide-react'

const METHODS = [
  { id: 'usdt', label: 'USDT (TRC-20)', icon: Bitcoin, placeholder: 'TYourWalletAddressHere123...' },
  { id: 'bank', label: 'Bank Transfer', icon: Landmark, placeholder: 'Bank account number / IBAN' },
  { id: 'card', label: 'Credit / Debit Card', icon: CreditCard, placeholder: 'Card number (digits only)' },
]

export function WithdrawPage() {
  const { user } = useAuth()
  const { summary, refetch: refetchSummary } = useAccountSummary()
  const { withdrawals, refetch: refetchWithdrawals } = useWithdrawals()
  const { push } = useToast()
  const [method, setMethod] = useState(METHODS[0])
  const [amount, setAmount] = useState('')
  const [address, setAddress] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const cash = summary ? Number(summary.cash) : 0
  const amt = parseFloat(amount) || 0

  async function submit() {
    if (!Number.isFinite(amt) || amt <= 0) { push('error', 'Enter a valid withdrawal amount.'); return }
    if (!address.trim()) { push('error', 'Enter your destination address.'); return }
    setSubmitting(true)
    const res = await submitWithdrawal({ amount: amt, destination: `${method.label}: ${address.trim()}` })
    setSubmitting(false)
    if (res.ok) {
      if (res.data.status === 'REJECTED') {
        push('error', 'Withdrawal rejected — insufficient available balance.')
      } else {
        push('success', `Withdrawal of $${amt.toFixed(2)} submitted for review.`)
        if (user) pushLocalNotification(user.id, { title: 'Withdrawal requested', body: `Your withdrawal of $${amt.toFixed(2)} via ${method.label} is pending review.`, kind: 'withdrawal' })
      }
      setAmount('')
      setAddress('')
      refetchWithdrawals()
      refetchSummary()
    } else {
      push('error', res.error)
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Form */}
        <div className="card p-6 lg:col-span-2">
          <h3 className="font-bold text-white">Withdraw funds</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {METHODS.map((m) => (
              <button key={m.id} onClick={() => setMethod(m)} className={`flex items-center gap-2 rounded-xl border p-3 text-left transition ${method.id === m.id ? 'border-gold-500/50 bg-gold-500/5' : 'border-ink-600 bg-ink-900 hover:border-ink-500'}`}>
                <m.icon className="h-5 w-5 text-ocean-400" />
                <span className="text-sm font-medium text-white">{m.label}</span>
              </button>
            ))}
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <label className="label">Destination address</label>
              <input className="input font-mono text-sm" placeholder={method.placeholder} value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div>
              <label className="label">Amount (USD)</label>
              <input className="input" type="number" min="1" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="flex items-center justify-between rounded-xl bg-ink-800 p-4 text-sm">
              <span className="text-slate-500">Available balance</span>
              <span className="font-mono font-bold text-white">{summary ? `$${cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</span>
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
                    <span className="font-mono font-bold text-white">${Number(w.amount).toFixed(2)}</span>
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
        <p>TRUST is a fictional demonstration platform. No real funds are involved. Withdrawal requests are simulated and processed by the admin panel for demonstration purposes.</p>
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
