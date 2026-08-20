import { useEffect, useMemo, useState } from 'react'
import { useOptionMarkets, useOptionBalance, useActiveOptionTrades, submitOptionTrade } from '../store/useOptions'
import { useToast } from '../components/Toast'
import PageHeader from '../components/PageHeader'
import { OptionsChart } from '../components/options/OptionsChart'
import { AssetIcon } from '../components/AssetIcon'
import { OptionsDurationSelector } from '../components/options/OptionsDurationSelector'
import { OptionsAmountInput, isOptionAmountValid } from '../components/options/OptionsAmountInput'
import { OptionsActiveTrade } from '../components/options/OptionsActiveTrade'
import { OptionsResult } from '../components/options/OptionsResult'
import { OptionsHistory } from '../components/options/OptionsHistory'
import type { OptionTrade } from '../types'
import { api } from '../lib/api'
import { getMarketStatus } from '../store/priceFeed'

export default function OptionsPage() {
  const { markets, loading: marketsLoading } = useOptionMarkets()
  const [symbol, setSymbol] = useState<string | null>(null)
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null)
  const [amount, setAmount] = useState('100')
  const [submitting, setSubmitting] = useState(false)
  const [justSettled, setJustSettled] = useState<OptionTrade | null>(null)
  const { push } = useToast()

  const { trades: activeTrades, refetch: refetchActive } = useActiveOptionTrades()

  const market = useMemo(() => markets.find((m) => m.symbol === symbol) ?? markets[0] ?? null, [markets, symbol])
  const { balance, refetch: refetchBalance } = useOptionBalance(market?.currency ?? 'USDT')

  useEffect(() => {
    if (!symbol && markets.length > 0) setSymbol(markets[0].symbol)
  }, [markets, symbol])

  useEffect(() => {
    if (market && market.durations.length > 0 && !market.durations.some((d) => d.durationSeconds === durationSeconds)) {
      setDurationSeconds(market.durations[0].durationSeconds)
    }
  }, [market, durationSeconds])

  // Poll the currently-displayed active trade (if any, for this asset) so
  // its status flips to a result card the moment the backend settles it —
  // never client-computed, always re-fetched from the backend.
  const activeForSymbol = activeTrades.find((t) => t.symbol === symbol)
  useEffect(() => {
    if (!activeForSymbol) return
    const id = setInterval(async () => {
      const fresh = await api.get<OptionTrade>(`/options/trades/${activeForSymbol.id}`)
      if (fresh.status === 'SETTLED') {
        setJustSettled(fresh)
        refetchActive()
        refetchBalance()
      }
    }, 1500)
    return () => clearInterval(id)
  }, [activeForSymbol?.id])

  const duration = market?.durations.find((d) => d.durationSeconds === durationSeconds) ?? null
  const status = market ? getMarketStatus(market.symbol) : 'loading'
  const availableBalance = balance ? Number(balance.cash) : null
  const amountValid = !!market && isOptionAmountValid(amount, market.minInvestment, market.maxInvestment, availableBalance)
  const canTrade = !!market && !!duration && amountValid && !activeForSymbol && status !== 'unavailable'
  const disabledReason = activeForSymbol
    ? 'You already have an active trade on this asset.'
    : status === 'unavailable'
    ? 'Market data is currently unavailable for this asset.'
    : !amountValid
    ? 'Enter a valid investment amount within the allowed range and your available balance.'
    : undefined

  async function submit(direction: 'BUY' | 'SELL') {
    if (!market || !duration) return
    setSubmitting(true)
    const res = await submitOptionTrade({ symbol: market.symbol, direction, investment: amount, durationSeconds: duration.durationSeconds })
    setSubmitting(false)
    if (res.ok) {
      push('success', `${direction} position opened on ${market.symbol}.`)
      refetchActive()
      refetchBalance()
    } else {
      push('error', res.error)
    }
  }

  if (marketsLoading) {
    return <div className="card p-10 text-center text-sm text-slate-500">Loading options markets…</div>
  }
  if (!market) {
    return (
      <div className="card p-10 text-center">
        <p className="text-sm font-semibold text-white">Options trading isn't available yet</p>
        <p className="mt-2 text-xs text-slate-500">No assets are currently configured for options trading. Check back soon.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Options"
        subtitle="Fixed-time predictions on live market prices — a separate product from spot trading"
        right={
          <div className="text-sm text-slate-400">
            Balance <span className="ml-1 font-mono font-semibold text-white">{balance ? `${Number(balance.cash).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${balance.currency}` : '—'}</span>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="card overflow-hidden p-4">
            <div className="mb-3 flex items-center gap-3">
              <AssetIcon symbol={market.symbol} size={32} />
              <select value={market.symbol} onChange={(e) => setSymbol(e.target.value)} className="input bg-ink-800 py-1.5 text-sm text-white">
                {markets.map((m) => <option key={m.symbol} value={m.symbol}>{m.displayName} ({m.symbol})</option>)}
              </select>
            </div>
            <OptionsChart symbol={market.symbol} height={420} />
          </div>
        </div>

        <div>
          {activeForSymbol ? (
            <OptionsActiveTrade trade={activeForSymbol} />
          ) : (
            <div className="card space-y-4 p-4">
              <div>
                <label className="label">Duration</label>
                <OptionsDurationSelector durations={market.durations} selected={durationSeconds} onSelect={setDurationSeconds} />
              </div>

              <OptionsAmountInput
                value={amount}
                onChange={setAmount}
                currency={market.currency}
                payoutPercent={duration?.payoutPercent ?? null}
                min={market.minInvestment}
                max={market.maxInvestment}
                availableBalance={availableBalance}
              />

              {status === 'unavailable' && (
                <div role="alert" className="rounded-lg border border-bear/30 bg-bear/10 px-3 py-2 text-xs text-bear">
                  Market data is currently unavailable for {market.symbol}. New trades are disabled until it recovers.
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <button
                  disabled={!canTrade || submitting}
                  onClick={() => submit('BUY')}
                  title={disabledReason}
                  aria-label="Buy — predict the price will be higher at expiry"
                  className="rounded-xl bg-bull py-4 text-lg font-bold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  BUY ↑
                </button>
                <button
                  disabled={!canTrade || submitting}
                  onClick={() => submit('SELL')}
                  title={disabledReason}
                  aria-label="Sell — predict the price will be lower at expiry"
                  className="rounded-xl bg-bear py-4 text-lg font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  SELL ↓
                </button>
              </div>
              <p className="text-center text-[11px] text-slate-600">BUY predicts the price will be HIGHER at expiry. SELL predicts LOWER. An exact match at expiry is a DRAW — your investment is returned.</p>
            </div>
          )}
        </div>
      </div>

      {activeTrades.length > 1 && (
        <div className="card overflow-hidden">
          <div className="border-b border-ink-700/60 px-4 py-3"><h3 className="font-bold text-white">Active Trades</h3></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs uppercase text-slate-500"><th className="px-4 py-2 text-left">Asset</th><th className="px-4 py-2 text-left">Direction</th><th className="px-4 py-2 text-right">Investment</th><th className="px-4 py-2 text-right">Payout</th><th className="px-4 py-2 text-right">Entry</th><th className="px-4 py-2 text-right">Expires</th></tr></thead>
              <tbody>
                {activeTrades.map((t) => (
                  <tr key={t.id} className="cursor-pointer border-t border-ink-700/40 hover:bg-ink-800/40" onClick={() => setSymbol(t.symbol)}>
                    <td className="px-4 py-2.5 font-medium text-white">{t.symbol}</td>
                    <td className={`px-4 py-2.5 font-semibold ${t.direction === 'BUY' ? 'text-bull' : 'text-bear'}`}>{t.direction}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{t.investment} {t.currency}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-bull">{t.payoutPercentSnapshot}%</td>
                    <td className="px-4 py-2.5 text-right font-mono">{t.entryPrice}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-400">{new Date(t.expiryAt).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <OptionsHistory symbols={markets.map((m) => m.symbol)} />

      {justSettled && <OptionsResult trade={justSettled} onDismiss={() => setJustSettled(null)} />}
    </div>
  )
}
