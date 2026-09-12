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
  // product (src/pages/OptionsPage.tsx) — nothing here is a new mechanism.
  const { markets: optionMarkets } = useOptionMarkets()
  const optionMarket = useMemo(() => optionMarkets.find((m) => m.symbol === symbol) ?? null, [optionMarkets, symbol])
  const { balance: optionBalance, refetch: refetchOptionBalance } = useOptionBalance(optionMarket?.currency ?? 'USDT')
  const { trades: activeOptionTrades, refetch: refetchActiveOptionTrades } = useActiveOptionTrades()
  const activeOptionForSymbol = activeOptionTrades.find((t) => t.symbol === symbol)
  const [optionAmount, setOptionAmount] = useState('100')
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
  const canTradeOption = !!optionMarket && !!optionDuration && optionAmountValid && !activeOptionForSymbol && status !== 'unavailable'
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

  async function submitOption(direction: 'BUY' | 'SELL') {
    if (!optionMarket || !optionDuration) return
    setSubmittingOption(true)
    const res = await submitOptionTrade({ symbol: optionMarket.symbol, direction, investment: optionAmount, durationSeconds: optionDuration.durationSeconds })
    setSubmittingOption(false)
    if (res.ok) {
      push('success', `${direction} position opened on ${optionMarket.symbol}.`)
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

        {/* Trading ticket — amount-tier options (Part 30). The user only
            ever types an amount; duration + profit are resolved
            automatically from it (see optionAmountTier.ts), then BUY/SELL
            opens a real fixed-time options trade at that duration. */}
        <div>
          {activeOptionForSymbol ? (
            <OptionsActiveTrade trade={activeOptionForSymbol} />
          ) : (
            <div className="card space-y-4 p-4">
              <div className="text-center">
                <h2 className="text-xl font-extrabold text-ocean-400">{optionMarket?.displayName ?? symbol}</h2>
                <p className="text-sm text-slate-500">{symbol.replace('/', '')}</p>
              </div>

              <OptionsDurationSelector durations={optionMarket?.durations ?? []} activeDurationSeconds={optionDuration?.durationSeconds ?? null} />

              <OptionsAmountInput
                value={optionAmount}
                onChange={setOptionAmount}
                currency={optionMarket?.currency ?? 'USDT'}
                payoutPercent={optionDuration?.payoutPercent ?? null}
                durationSeconds={optionDuration?.durationSeconds ?? null}
                min={optionMarket?.minInvestment ?? '1'}
                max={optionMarket?.maxInvestment ?? null}
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

              <div className="grid grid-cols-2 gap-3">
                <button
                  disabled={!canTradeOption || submittingOption}
                  onClick={() => submitOption('BUY')}
                  title={optionDisabledReason}
                  aria-label="Buy — predict the price will be higher at expiry"
                  className="rounded-xl bg-bull py-4 text-lg font-extrabold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  BUY
                </button>
                <button
                  disabled={!canTradeOption || submittingOption}
                  onClick={() => submitOption('SELL')}
                  title={optionDisabledReason}
                  aria-label="Sell — predict the price will be lower at expiry"
                  className="rounded-xl bg-bear py-4 text-lg font-extrabold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  SELL
                </button>
              </div>
              <p className="text-center text-[11px] text-slate-600">BUY predicts the price will be HIGHER at expiry. SELL predicts LOWER. An exact match at expiry is a DRAW — your investment is returned.</p>
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
