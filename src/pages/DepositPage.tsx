import { useEffect, useState } from 'react'
import { useAuth } from '../store/auth'
import { useAccountSummary, submitDeposit, pushLocalNotification } from '../store/useStore'
import { useToast } from '../components/Toast'
import { QrCode } from '../components/QrCode'
import { Bitcoin, Landmark, CreditCard, Copy, Clock, Gift, ArrowRight, Check } from 'lucide-react'

const METHODS = [
  { id: 'usdt', label: 'USDT (TRC-20)', icon: Bitcoin, desc: 'Instant · 1 confirmation', address: 'TJX9aKp7m3QrVb8sN2cWdFzL4hY6tRxEuP', color: 'text-ocean-400' },
  { id: 'bank', label: 'Bank Transfer', icon: Landmark, desc: '1–3 business days', address: 'TRUST-SEC · ACH Routing: 021000021 · Acct: 8841290074', color: 'text-gold-400' },
  { id: 'card', label: 'Credit / Debit Card', icon: CreditCard, desc: 'Instant · Visa/Mastercard', address: '4242 4242 4242 4242 · Exp: 12/28 · CVC: 123', color: 'text-bull' },
]

// Marketing copy only — the backend has no bonus concept in this phase.
// The amount submitted to POST /deposits is always the plain deposit
// amount; no bonus is ever credited automatically.
const BONUS_PCT = 20
const BONUS_MIN = 500

export function DepositPage() {
  const { user } = useAuth()
  const { summary, refetch } = useAccountSummary()
  const { push } = useToast()
  const [method, setMethod] = useState(METHODS[0])
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [countdown, setCountdown] = useState('')

  useEffect(() => {
    const target = new Date(); target.setHours(target.getHours() + 23, target.getMinutes() + 59, 59)
    const id = setInterval(() => {
      const diff = target.getTime() - Date.now()
      const h = Math.floor(diff / 3_600_000), m = Math.floor((diff % 3_600_000) / 60_000), s = Math.floor((diff % 60_000) / 1000)
      setCountdown(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`)
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const amt = parseFloat(amount) || 0
  const bonus = amt >= BONUS_MIN ? (amt * BONUS_PCT) / 100 : 0

  async function submit() {
    if (!Number.isFinite(amt) || amt <= 0) { push('error', 'Enter a valid deposit amount.'); return }
    setSubmitting(true)
    const res = await submitDeposit({ amount: amt, method: method.label })
    setSubmitting(false)
    if (res.ok) {
      push('success', `Deposit of $${amt.toFixed(2)} via ${method.label} submitted. Pending confirmation.`)
      if (user) pushLocalNotification(user.id, { title: 'Deposit submitted', body: `Your ${method.label} deposit of $${amt.toFixed(2)} is pending confirmation.`, kind: 'deposit' })
      setSubmitted(true)
      setTimeout(() => setSubmitted(false), 8000)
      setAmount('')
      refetch()
    } else {
      push('error', res.error)
    }
  }

  return (
    <div className="space-y-6">
      {/* Bonus banner */}
      <div className="relative overflow-hidden rounded-2xl border border-gold-500/30 bg-gradient-to-r from-gold-500/10 via-ink-850 to-ink-850 p-6">
        <div className="absolute right-0 top-0 h-full w-1/3 bg-gold-500/5 blur-3xl" />
        <div className="relative flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <Gift className="h-8 w-8 text-gold-400" />
            <div>
              <h3 className="text-lg font-bold text-white">Deposit ${BONUS_MIN}, get {BONUS_PCT}% bonus</h3>
              <p className="text-sm text-slate-400">Bonus credited instantly upon confirmation. Ends in:</p>
            </div>
          </div>
          <p className="font-mono text-2xl font-bold text-gold-400">{countdown || '23:59:59'}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Method selection + QR */}
        <div className="card p-6 lg:col-span-2">
          <h3 className="font-bold text-white">Choose a payment method</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {METHODS.map((m) => (
              <button key={m.id} onClick={() => setMethod(m)} className={`flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition ${method.id === m.id ? 'border-gold-500/50 bg-gold-500/5' : 'border-ink-600 bg-ink-900 hover:border-ink-500'}`}>
                <m.icon className={`h-6 w-6 ${m.color}`} />
                <p className="text-sm font-semibold text-white">{m.label}</p>
                <p className="text-xs text-slate-500">{m.desc}</p>
              </button>
            ))}
          </div>

          <div className="mt-6 flex flex-col items-center gap-5 rounded-xl border border-ink-600 bg-ink-900 p-6 sm:flex-row">
            <div className="rounded-xl bg-white p-3 shrink-0">
              <QrCode value={`trust-deposit:${method.id}:${user?.id}`} size={150} />
            </div>
            <div className="flex-1 w-full">
              <p className="text-sm font-medium text-white">Send your deposit to this address</p>
              <p className="mt-1 text-xs text-slate-500">{method.desc}</p>
              <div className="mt-3 flex items-center gap-2">
                <code className="flex-1 truncate rounded-lg bg-ink-800 px-3 py-2.5 font-mono text-xs text-gold-300">{method.address}</code>
                <button onClick={() => {
                  try { navigator.clipboard?.writeText(method.address); push('info', 'Address copied.') }
                  catch { push('error', 'Unable to copy address to clipboard.') }
                }} className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-600 bg-ink-800 text-slate-400 hover:text-white">
                  <Copy className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500"><Clock className="h-3.5 w-3.5" /> Funds will be credited after network confirmation.</p>
            </div>
          </div>

          {submitted && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-gold-500/30 bg-gold-500/10 px-4 py-3 text-sm text-gold-300 animate-fade-in">
              <Check className="h-4 w-4" /> Deposit submitted. Waiting for confirmation…
            </div>
          )}
        </div>

        {/* Amount + summary */}
        <div className="card p-6">
          <h3 className="font-bold text-white">Enter deposit amount</h3>
          <div className="mt-4">
            <label className="label">Amount (USD)</label>
            <input className="input" type="number" min="1" placeholder="500.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="mt-3 flex gap-2">
            {['100', '500', '1000', '5000'].map((v) => (
              <button key={v} onClick={() => setAmount(v)} className="flex-1 rounded-lg border border-ink-600 bg-ink-900 py-1.5 text-xs font-medium text-slate-300 hover:border-ink-500">${v}</button>
            ))}
          </div>
          <div className="mt-5 space-y-2.5 rounded-xl bg-ink-800 p-4 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Deposit amount</span><span className="font-mono text-white">${amt.toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Bonus ({BONUS_PCT}%)</span><span className="font-mono text-gold-400">+${bonus.toFixed(2)}</span></div>
            <div className="border-t border-ink-700 pt-2.5 flex justify-between"><span className="font-semibold text-white">Total credit</span><span className="font-mono font-bold text-bull">${(amt + bonus).toFixed(2)}</span></div>
          </div>
          <button onClick={submit} disabled={submitting} className="btn-gold mt-5 w-full py-3">{submitting ? 'Submitting…' : 'Submit deposit'} <ArrowRight className="h-4 w-4" /></button>
          <p className="mt-3 text-center text-xs text-slate-500">Current balance: {summary ? `$${Number(summary.cash).toFixed(2)}` : '—'}</p>
        </div>
      </div>
    </div>
  )
}
