import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { usePositions, useOrders, computePositionPnl, useMarketConfigs, useExecutionStatus, useAssetBalances } from '../store/useStore'
import { useOptionMarkets, useOptionBalance, useActiveOptionTrades, submitOptionTrade } from '../store/useOptions'
import { getPrice, getMarketStatus, getStats24h } from '../store/priceFeed'
import { useToast } from '../components/Toast'
import PageHeader from '../components/PageHeader'
import { CandlestickChart } from '../components/CandlestickChart'
import { StatusBadge } from '../components/StatusBadge'
import { PriceChange } from '../components/PriceChange'
import { EmptyState } from '../components/EmptyState'
import { PositionCard } from '../components/PositionCard'
import { SpotHoldings } from '../components/SpotHoldings'
import { OptionsDurationSelector } from '../components/options/OptionsDurationSelector'
import { OptionsAmountInput, isOptionAmountValid } from '../components/options/OptionsAmountInput'
import { resolveDurationForAmount, nextTier } from '../components/options/optionAmountTier'
import { OptionsActiveTrade } from '../components/options/OptionsActiveTrade'
import { OptionsTradeSummary } from '../components/options/OptionsTradeSummary'
import { OptionsResult } from '../components/options/OptionsResult'
import type { OptionTrade } from '../types'
import { api } from '../lib/api'
import { Inbox, History } from 'lucide-react'

function useQuery() { return new URLSearchParams(useLocation().search) }

export default function TradePage() {
  const q = useQuery()
  const defaultSymbol = q.get('symbol') ?? 'XAU/USD'
  const [symbol, setSymbol] = useState(defaultSymbol)
  const [activePositionId, setActivePositionId] = useState<string | null>(null)
  const [, setTick] = useState(0)

  const { positions } = usePositions()
  const { orders } = useOrders()
  const { markets } = useMarketConfigs()
  const { status: executionStatus } = useExecutionStatus()
  const { assets, loading: assetsLoading } = useAssetBalances()
  const { push } = useToast()

  useEffect(() => { setSymbol(defaultSymbol) }, [defaultSymbol])

  // The market's own spend/quote asset (e.g. USDT for BTC/USDT) — resolved
  // from real backend config, never hardcoded. Falls back to 'USD' only
  // while the market list hasn't loaded yet (never a guess once it has).
  // Still drives the chart below, unchanged.
  const quoteAsset = markets.find((m) => m.symbol === symbol)?.quoteAsset || 'USD'

  // Keep the price ticker live while this page is open. Positions/orders
  // themselves only ever change via a real backend call, not this timer.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const current = getPrice(symbol)
  const status = getMarketStatus(symbol)
  const openPositions = positions.filter(p => p.status === 'OPEN')

  // ---- Trading ticket — amount-tier options (Part 30): the amount typed
  // is the ONLY thing the user enters; duration + profit are resolved
  // automatically from it (never manually picked), then a real fixed-time
  // options trade is created for whichever duration resolved. Reuses the
  // exact same components/logic already built and tested for the Options
  // product — nothing here is a new mechanism.
  const { markets: optionMarkets } = useOptionMarkets()
  const optionMarket = useMemo(() => optionMarkets.find((m) => m.symbol === symbol) ?? null, [optionMarkets, symbol])
  const { balance: optionBalance, refetch: refetchOptionBalance } = useOptionBalance(optionMarket?.currency ?? 'USDT')
  const { trades: activeOptionTrades, refetch: refetchActiveOptionTrades } = useActiveOptionTrades()
  const activeOptionForSymbol = activeOptionTrades.find((t) => t.symbol === symbol)
  const [optionAmount, setOptionAmount] = useState('')
  // Direction is now a SELECTABLE state (Step 4), never an immediate-submit
  // click — Place Trade (Step 6) is the only action that actually creates
  // the trade. Reset to null whenever the amount changes, so a stale
  // direction chosen against a since-changed amount/duration/ROI can never
  // survive into a submission (see the useEffect below).
  const [selectedDirection, setSelectedDirection] = useState<'BUY' | 'SELL' | null>(null)
  const [submittingOption, setSubmittingOption] = useState(false)
  const [justSettledOption, setJustSettledOption] = useState<OptionTrade | null>(null)

  const optionDuration = useMemo(
    () => (optionMarket ? resolveDurationForAmount(optionMarket.durations, parseFloat(optionAmount)) : null),
    [optionMarket, optionAmount],
  )
  const upcomingOptionTier = useMemo(
    () => (optionMarket ? nextTier(optionMarket.durations, parseFloat(optionAmount) || 0) : null),
    [optionMarket, optionAmount],
  )
  const optionAvailableBalance = optionBalance ? Number(optionBalance.cash) : null
  const optionAmountValid = !!optionMarket && isOptionAmountValid(optionAmount, optionMarket.minInvestment, optionMarket.maxInvestment, optionAvailableBalance)
  // Amount + duration/ROI must stay synchronized (Step 3 requirement) — the
  // moment the amount (or the resolved duration/tier it maps to) changes,
  // any previously-selected direction is discarded rather than silently
  // carried forward against a now-different ROI/duration.
  useEffect(() => {
    setSelectedDirection(null)
  }, [optionAmount, optionDuration?.durationSeconds, symbol])
  const canSelectDirection = !!optionMarket && !!optionDuration && optionAmountValid && !activeOptionForSymbol && status !== 'unavailable'
  const canPlaceTrade = canSelectDirection && selectedDirection !== null
  const optionDisabledReason = !optionMarket
    ? `Options trading isn't configured for ${symbol} yet.`
    : activeOptionForSymbol
    ? 'You already have an active trade on this asset.'
    : status === 'unavailable'
    ? 'Market data is currently unavailable for this asset.'
    : !optionAmountValid
    ? 'Enter a valid investment amount within the allowed range and your available balance.'
    : !optionDuration
    ? `Enter at least ${upcomingOptionTier?.minAmount ?? optionMarket.minInvestment} ${optionMarket.currency} to unlock a duration/profit tier.`
    : !selectedDirection
    ? 'Select UP or DOWN first.'
    : undefined

  // Poll the currently-displayed active option trade so its status flips to
  // a result card the moment the backend settles it — never client-computed.
  useEffect(() => {
    if (!activeOptionForSymbol) return
    const id = setInterval(async () => {
      const fresh = await api.get<OptionTrade>(`/options/trades/${activeOptionForSymbol.id}`)
      if (fresh.status === 'SETTLED') {
        setJustSettledOption(fresh)
        refetchActiveOptionTrades()
        refetchOptionBalance()
      }
    }, 1500)
    return () => clearInterval(id)
  }, [activeOptionForSymbol?.id])

  // Step 6 — Place Trade. The final submission: Market + Amount + Duration
  // (and the ROI it carries, snapshotted server-side from that duration
  // row, never sent by the client) + Direction, all together. Clicking
  // UP/DOWN (Step 4) only selects selectedDirection state — it is NOT the
  // submit action.
  async function placeTrade() {
    if (!optionMarket || !optionDuration || !selectedDirection) return
    setSubmittingOption(true)
    const res = await submitOptionTrade({ symbol: optionMarket.symbol, direction: selectedDirection, investment: optionAmount, durationSeconds: optionDuration.durationSeconds })
    setSubmittingOption(false)
    if (res.ok) {
      push('success', `${selectedDirection === 'BUY' ? 'UP' : 'DOWN'} position opened on ${optionMarket.symbol}.`)
      setSelectedDirection(null)
      refetchActiveOptionTrades()
      refetchOptionBalance()
    } else {
      push('error', res.error)
    }
  }

  const positionsWithPnl = useMemo(() => openPositions.map(p => ({ p, pnl: computePositionPnl(p) })), [openPositions])
  const activeEntry = activePositionId ? positionsWithPnl.find(x => x.p.id === activePositionId) : undefined

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trade"
        subtitle="Trade with your account balance."
        right={<div className="flex items-center gap-2 text-sm text-slate-400">{symbol} <span className="font-mono text-white">${current.toFixed(current < 1 ? 4 : 2)}</span> <StatusBadge status={status} /></div>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Chart */}
        <div className="lg:col-span-2">
          <div className="card overflow-hidden p-4">
            <CandlestickChart symbol={symbol} height={440} quoteAsset={quoteAsset} />
          </div>
          <Stats24hRow symbol={symbol} />
        </div>

        {/* Trading ticket — the seven-tier amount-based duration system
            (final trading spec). Step 1: market (this whole ticket is
            already scoped to the selected symbol). Step 2: amount. Step 3:
            duration/ROI, resolved entirely from the amount — never
            manually picked (see optionAmountTier.ts's
            resolveDurationForAmount, independently re-enforced by the
            backend's OptionsRiskService at trade-creation time). Step 4:
            direction (UP/DOWN) — a SELECTION, not a submit action. Step 5:
            Trade Summary. Step 6: Place Trade, the only actual submission. */}
        <div>
          {activeOptionForSymbol ? (
            <OptionsActiveTrade trade={activeOptionForSymbol} />
          ) : (
            <div className="card space-y-4 p-4">
              {/* Step 1 — Market */}
              <div className="text-center">
                <h2 className="text-xl font-extrabold text-ocean-400">{optionMarket?.displayName ?? symbol}</h2>
                <p className="text-sm text-slate-500">{symbol.replace('/', '')}</p>
              </div>

              {/* Step 2 — Trade Amount */}
              <OptionsAmountInput
                value={optionAmount}
                onChange={setOptionAmount}
                currency={optionMarket?.currency ?? 'USDT'}
                min={optionMarket ? optionMarket.minInvestment : '500'}
                max={optionMarket ? optionMarket.maxInvestment : '500000'}
                availableBalance={optionAvailableBalance}
              />
              {!optionDuration && optionMarket && optionAmount.trim() !== '' && upcomingOptionTier && (
                <p className="text-center text-xs text-slate-500">Enter at least {upcomingOptionTier.minAmount} {optionMarket.currency} to unlock the {upcomingOptionTier.durationSeconds}s / {upcomingOptionTier.payoutPercent}% tier.</p>
              )}

              {!optionMarket && (
                <div role="alert" className="rounded-lg border border-bear/30 bg-bear/10 px-3 py-2 text-xs text-bear">
                  Options trading isn't configured for {symbol} yet.
                </div>
              )}
              {optionMarket && status === 'unavailable' && (
                <div role="alert" className="rounded-lg border border-bear/30 bg-bear/10 px-3 py-2 text-xs text-bear">
                  Market data is currently unavailable for {symbol}. New trades are disabled until it recovers.
                </div>
              )}

              {/* Step 3 — Duration (amount-based, read-only tier ladder) */}
              <OptionsDurationSelector
                durations={optionMarket?.durations ?? []}
                activeDurationSeconds={optionDuration?.durationSeconds ?? null}
                marketMaxInvestment={optionMarket?.maxInvestment ?? null}
              />

              {/* Step 4 — Direction (UP/DOWN). Selecting one does NOT submit
                  the trade — it only sets selectedDirection state; Place
                  Trade below is the actual submission. */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  disabled={!canSelectDirection || submittingOption}
                  onClick={() => setSelectedDirection('BUY')}
                  title={optionDisabledReason}
                  aria-pressed={selectedDirection === 'BUY'}
                  aria-label="Up — predict the price will be higher at expiry"
                  className={`rounded-xl py-4 text-lg font-extrabold text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    selectedDirection === 'BUY' ? 'bg-bull shadow-glow-sm ring-2 ring-white/40' : 'bg-bull/70 hover:brightness-105'
                  }`}
                >
                  UP
                </button>
                <button
                  disabled={!canSelectDirection || submittingOption}
                  onClick={() => setSelectedDirection('SELL')}
                  title={optionDisabledReason}
                  aria-pressed={selectedDirection === 'SELL'}
                  aria-label="Down — predict the price will be lower at expiry"
                  className={`rounded-xl py-4 text-lg font-extrabold text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    selectedDirection === 'SELL' ? 'bg-bear shadow-glow-sm ring-2 ring-white/40' : 'bg-bear/70 hover:brightness-95'
                  }`}
                >
                  DOWN
                </button>
              </div>
              <p className="text-center text-[11px] text-slate-600">UP predicts the price will be HIGHER at expiry. DOWN predicts LOWER. An exact match at expiry is a DRAW — your investment is returned.</p>

              {/* Step 5 — Trade Summary (shown once amount, duration, AND
                  direction are all selected). */}
              {selectedDirection && optionDuration && (
                <OptionsTradeSummary
                  investment={parseFloat(optionAmount)}
                  currency={optionMarket?.currency ?? 'USDT'}
                  payoutPercent={optionDuration.payoutPercent}
                />
              )}

              {/* Step 6 — Place Trade: the only action that submits Market +
                  Amount + Duration (+ its ROI) + Direction together. */}
              <button
                disabled={!canPlaceTrade || submittingOption}
                onClick={placeTrade}
                title={optionDisabledReason}
                className="w-full rounded-xl bg-gold-500 py-3.5 text-base font-extrabold text-ink-950 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submittingOption ? 'Placing…' : 'PLACE TRADE'}
              </button>
            </div>
          )}
        </div>
      </div>

      {justSettledOption && <OptionsResult trade={justSettledOption} onDismiss={() => setJustSettledOption(null)} />}

      {/* Spot Holdings — real, non-zero ledger balances by currency. Not a
          database Position: no price, no avgEntryPrice, no unrealized P&L.
          Distinct from "Open Positions" below, which tracks a different
          (currently unused) derivative-style concept. */}
      <div className="card overflow-hidden">
        <div className="border-b border-ink-700/60 px-4 py-3"><h3 className="font-bold text-white">Spot Holdings</h3></div>
        <SpotHoldings assets={assets} loading={assetsLoading} executionStatus={executionStatus} />
      </div>

      {/* Open positions & order history below */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="border-b border-ink-700/60 px-4 py-3"><h3 className="font-bold text-white">Open Positions</h3></div>
          {positionsWithPnl.length === 0 ? (
            <EmptyState icon={Inbox} title="No open positions" hint="A filled spot trade is not lost — see Spot Holdings above for your actual balances." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase text-slate-500">
                    <th className="px-4 py-2 text-left">Symbol</th>
                    <th className="px-4 py-2 text-right">Quantity</th>
                    <th className="px-4 py-2 text-right">Entry</th>
                    <th className="px-4 py-2 text-right">Mark</th>
                    <th className="px-4 py-2 text-right">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {positionsWithPnl.map(({ p, pnl }) => (
                    <tr key={p.id} className="cursor-pointer border-t border-ink-700/40 hover:bg-ink-800/40" onClick={() => setActivePositionId(p.id)}>
                      <td className="px-4 py-2.5 font-medium text-white">{p.symbol}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{Number(p.quantity).toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">${Number(p.avgEntryPrice).toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{p.currentPrice != null ? `$${Number(p.currentPrice).toFixed(2)}` : '—'}</td>
                      <td className="px-4 py-2.5 text-right"><PriceChange value={pnl} mode="usd" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="border-b border-ink-700/60 px-4 py-3"><h3 className="font-bold text-white">Order History</h3></div>
          {orders.length === 0 ? (
            <EmptyState icon={History} title="Your order attempts will appear here" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-xs uppercase text-slate-500"><th className="px-4 py-2 text-left">Time</th><th className="px-4 py-2 text-left">Order</th><th className="px-4 py-2 text-left">Status</th></tr></thead>
                <tbody>
                  {orders.slice(0, 20).map(o => (
                    <tr key={o.id} className="border-t border-ink-700/40">
                      <td className="px-4 py-2.5 text-slate-400">{new Date(o.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-2.5 font-medium text-white">{o.side} {o.symbol} — {Number(o.quantity).toFixed(2)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`chip ${o.status === 'REJECTED' ? 'border-bear/30 text-bear' : 'border-gold-500/30 text-gold-300'}`} title={o.rejectionReason ?? undefined}>{o.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {activeEntry && (
        <PositionCard
          position={activeEntry.p}
          pnl={activeEntry.pnl}
          marketStatus={getMarketStatus(activeEntry.p.symbol)}
          onDismiss={() => setActivePositionId(null)}
        />
      )}
    </div>
  )
}

// Real 24h stats (Phase 6C, Part 10/16) — only ever renders fields the
// provider actually supplied (Binance does for its pairs; nothing else
// does yet), never a placeholder or computed value. Renders nothing at all
// if none are available, rather than a row of dashes.
function Stats24hRow({ symbol }: { symbol: string }) {
  const stats = getStats24h(symbol)
  const hasAny = stats.highPrice != null || stats.lowPrice != null || stats.volume != null || stats.priceChangePercent != null
  if (!hasAny) return null
  const fmt = (n: number | null) => (n == null ? null : n < 1 ? n.toFixed(4) : n.toLocaleString(undefined, { maximumFractionDigits: 2 }))
  return (
    <div className="mt-3 flex flex-wrap gap-4 rounded-xl border border-ink-700 bg-ink-900/60 px-4 py-3 text-sm">
      {stats.priceChangePercent != null && (
        <div><span className="text-slate-500">24h Change </span><span className={`font-mono font-semibold ${stats.priceChangePercent >= 0 ? 'text-bull' : 'text-bear'}`}>{stats.priceChangePercent >= 0 ? '+' : ''}{stats.priceChangePercent.toFixed(2)}%</span></div>
      )}
      {stats.highPrice != null && <div><span className="text-slate-500">24h High </span><span className="font-mono text-white">${fmt(stats.highPrice)}</span></div>}
      {stats.lowPrice != null && <div><span className="text-slate-500">24h Low </span><span className="font-mono text-white">${fmt(stats.lowPrice)}</span></div>}
      {stats.volume != null && <div><span className="text-slate-500">24h Volume </span><span className="font-mono text-white">{fmt(stats.volume)}</span></div>}
    </div>
  )
}
