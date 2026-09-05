import { useEffect, useMemo, useState } from 'react'
import { useCryptoAssets, useResolvedCryptoAddress, submitCryptoDeposit, uploadDepositProof } from '../store/useCryptoDeposits'
import { useToast } from '../components/Toast'
import { CryptoAssetSelector } from '../components/deposits/CryptoAssetSelector'
import { CryptoNetworkSelector } from '../components/deposits/CryptoNetworkSelector'
import { CryptoAddressDisplay } from '../components/deposits/CryptoAddressDisplay'
import { DepositProofUpload } from '../components/deposits/DepositProofUpload'
import { ArrowRight, Check } from 'lucide-react'

// Multi-Asset Crypto Deposit. This page no longer offers Internal Transfer /
// Bank Transfer / Credit Card, but it DOES offer every crypto asset the
// backend currently reports as enabled-with-a-configured-network (GET
// /crypto-deposits/assets, admin-configured via Deposit Management) — never
// a hardcoded single asset, and never a fabricated one. If nothing is
// currently configured at all, the honest "unavailable" state below is
// shown. The underlying Internal Transfer submission path (submitDeposit in
// store/useStore.ts, backing POST /deposits with a non-CRYPTO method) is
// untouched and still reachable elsewhere if ever needed — only this page's
// UI stopped exposing it.

export function DepositPage() {
  const { assets, loading: assetsLoading } = useCryptoAssets()
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const [networkCode, setNetworkCode] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submittedDepositId, setSubmittedDepositId] = useState<string | null>(null)
  const { push } = useToast()

  // Defaults to the first asset the backend returns, but only ONCE — an
  // explicit user selection (below) is never overwritten by a later refetch.
  useEffect(() => {
    if (!selectedSymbol && assets.length > 0) setSelectedSymbol(assets[0].symbol)
  }, [assets, selectedSymbol])

  const selected = useMemo(() => assets.find((a) => a.symbol === selectedSymbol) ?? null, [assets, selectedSymbol])

  useEffect(() => {
    if (selected && selected.networks.length > 0 && !selected.networks.some((n) => n.networkCode === networkCode)) {
      setNetworkCode(selected.networks[0].networkCode)
    }
    if (selected && selected.networks.length === 0) setNetworkCode(null)
  }, [selected, networkCode])

  const { resolved, loading: resolving, error: resolveError } = useResolvedCryptoAddress(selected?.symbol ?? null, networkCode)

  const amt = parseFloat(amount)
  const amountValid = Number.isFinite(amt) && amt > 0
  const minimum = resolved?.minimumDeposit ? parseFloat(resolved.minimumDeposit) : null
  const belowMinimum = amountValid && minimum != null && amt < minimum
  const canSubmit = !!resolved && amountValid && !belowMinimum && !submitting

  async function submit() {
    if (!selected || !networkCode || !resolved) return
    setSubmitting(true)
    const res = await submitCryptoDeposit({ amount, cryptoAssetSymbol: selected.symbol, networkCode })
    if (!res.ok) {
      setSubmitting(false)
      push('error', res.error)
      return
    }
    if (proofFile) {
      const proofRes = await uploadDepositProof(res.data.id, proofFile)
      if (!proofRes.ok) push('error', `Deposit submitted, but the proof upload failed: ${proofRes.error}`)
    }
    setSubmitting(false)
    setSubmittedDepositId(res.data.id)
    setAmount('')
    setProofFile(null)
    push('success', `${selected.symbol} deposit submitted. Pending admin verification.`)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Deposit Crypto</h1>
        <p className="mt-1 text-sm text-slate-400">Fund your account with crypto.</p>
      </div>

      {assetsLoading ? (
        <div className="card p-10 text-center text-sm text-slate-500">Loading…</div>
      ) : assets.length === 0 || !selected ? (
        <div className="card p-10 text-center">
          <p className="text-sm font-semibold text-white">Crypto deposits are currently unavailable.</p>
          <p className="mt-2 text-xs text-slate-500">Check back soon, or contact support for assistance.</p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card space-y-4 p-6">
            <div>
              <label htmlFor="crypto-asset-select" className="label">Crypto</label>
              <CryptoAssetSelector
                assets={assets}
                selected={selected.symbol}
                onSelect={(symbol) => { setSelectedSymbol(symbol); setNetworkCode(null) }}
              />
            </div>

            <CryptoNetworkSelector networks={selected.networks} selected={networkCode} onSelect={setNetworkCode} />

            {resolving && <div className="rounded-xl border border-ink-700 bg-ink-900 p-6 text-center text-sm text-slate-500">Loading receiving address…</div>}
            {resolveError && <div role="alert" className="rounded-xl border border-bear/30 bg-bear/10 p-4 text-sm text-bear">{resolveError}</div>}
            {resolved && <CryptoAddressDisplay resolved={resolved} />}
          </div>

          <div className="card space-y-4 p-6">
            <div>
              <label htmlFor="crypto-amount-input" className="label">Amount ({selected.symbol})</label>
              <div className="relative">
                <input id="crypto-amount-input" className="input pr-16 font-mono" type="number" min="0" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">{selected.symbol}</span>
              </div>
            </div>
            {belowMinimum && (
              <p role="alert" className="rounded-lg bg-bear/10 px-3 py-2 text-xs text-bear">Minimum deposit is {minimum} {selected.symbol}.</p>
            )}

            <DepositProofUpload file={proofFile} onSelect={setProofFile} />

            <button onClick={submit} disabled={!canSubmit} className="btn-gold w-full py-3 disabled:cursor-not-allowed disabled:opacity-40">
              {submitting ? 'Submitting…' : 'Submit Deposit'} <ArrowRight className="h-4 w-4" />
            </button>

            {submittedDepositId && (
              <div className="flex items-center gap-2 rounded-xl border border-gold-500/30 bg-gold-500/10 px-4 py-3 text-sm text-gold-300">
                <Check className="h-4 w-4" /> Deposit submitted — pending admin verification.
              </div>
            )}
            <p className="text-center text-xs text-slate-500">Deposits are credited only after admin verification, per the platform's manual-review process.</p>
          </div>
        </div>
      )}
    </div>
  )
}
