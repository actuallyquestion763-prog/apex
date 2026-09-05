import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowUpDown } from 'lucide-react'
import { useToast } from '../components/Toast'
import { ConvertAssetSelector } from '../components/convert/ConvertAssetSelector'
import { submitConvert, CONVERTIBLE_CURRENCIES } from '../store/useConvert'
import { getPrice } from '../store/priceFeed'

// Live preview only — display math using the same real, already-running
// price feed the Trade/Dashboard pages use (never a fabricated rate). The
// backend independently re-derives the actual rate from its own quotes at
// submission time; this preview can never be what actually gets recorded.
function priceInUsdt(currency: string): number {
  if (currency === 'USDT') return 1
  return getPrice(`${currency}/USDT`)
}

export function ConvertPage() {
  const navigate = useNavigate()
  const { push } = useToast()
  const [fromCurrency, setFromCurrency] = useState('USDT')
  const [toCurrency, setToCurrency] = useState('BTC')
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const amt = parseFloat(amount)
  const amountValid = Number.isFinite(amt) && amt > 0
  const fromPrice = priceInUsdt(fromCurrency)
  const toPrice = priceInUsdt(toCurrency)
  const toAmount = amountValid && fromPrice > 0 && toPrice > 0 ? (amt * fromPrice) / toPrice : 0

  function swap() {
    setFromCurrency(toCurrency)
    setToCurrency(fromCurrency)
  }

  async function submit() {
    if (!amountValid) return
    setSubmitting(true)
    const res = await submitConvert({ fromCurrency, toCurrency, amount })
    setSubmitting(false)
    if (res.ok) {
      push('success', `Converted ${res.data.fromAmount} ${fromCurrency} to ${res.data.toAmount} ${toCurrency}.`)
      setAmount('')
    } else {
      push('error', res.error)
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={() => navigate(-1)} aria-label="Back" className="text-slate-400 transition hover:text-white">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold text-white">Convert</h1>
      </div>

      <div className="card space-y-3 p-4">
        <p className="label">From</p>
        <ConvertAssetSelector currencies={CONVERTIBLE_CURRENCIES.filter((c) => c !== toCurrency)} selected={fromCurrency} onSelect={setFromCurrency} />
        <input
          className="input font-mono text-lg"
          type="number"
          min="0"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      <div className="flex justify-center">
        <button
          onClick={swap}
          aria-label="Swap From and To"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-ink-600 bg-ink-800 text-gold-400 transition hover:border-gold-500/40"
        >
          <ArrowUpDown className="h-4 w-4" />
        </button>
      </div>

      <div className="card space-y-3 p-4">
        <p className="label">To</p>
        <ConvertAssetSelector currencies={CONVERTIBLE_CURRENCIES.filter((c) => c !== fromCurrency)} selected={toCurrency} onSelect={setToCurrency} />
        <p className="font-mono text-lg text-ocean-300">
          {toAmount > 0 ? toAmount.toFixed(8) : '0.00000000'} <span className="text-sm text-slate-500">{toCurrency}</span>
        </p>
      </div>

      <button
        onClick={submit}
        disabled={!amountValid || submitting}
        className="btn-gold w-full py-3 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? 'Converting…' : 'Convert Now'}
      </button>
      <p className="text-center text-[11px] text-slate-600">The exact rate and amounts are confirmed by the backend at the moment you convert — this preview may shift slightly with the live market price.</p>
    </div>
  )
}
