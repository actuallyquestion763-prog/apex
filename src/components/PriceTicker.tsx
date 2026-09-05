import { useEffect, useState } from 'react'
import { snapshot, tickAll } from '../store/priceFeed'
import { useMarketConfigs } from '../store/useStore'
import type { TickerPrice } from '../types'
import { TrendingUp, TrendingDown } from 'lucide-react'

// Explicit symbol list instead of SYMBOLS.slice(0, 4): the ticker's visible
// set shouldn't silently depend on where a symbol lands in priceFeed's array.
const TICKER_SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'USDT/USD', 'XRP/USDT', 'XAU/USD']

export function PriceTicker() {
  const [prices, setPrices] = useState<TickerPrice[]>(snapshot)
  const { markets } = useMarketConfigs()

  useEffect(() => {
    setPrices(snapshot())
    const id = setInterval(() => setPrices(tickAll()), 1500)
    return () => clearInterval(id)
  }, [])

  const display = TICKER_SYMBOLS.map((sym) => prices.find((p) => p.symbol === sym))
    // XAU/USD has no price until the market proxy returns real data at least once;
    // skip it rather than showing a fabricated/placeholder $0.00.
    .filter((p): p is TickerPrice => !!p && (p.symbol !== 'XAU/USD' || p.price > 0))

  return (
    <div className="border-y border-ink-700/60 bg-ink-900/80 backdrop-blur-sm overflow-hidden">
      <div className="flex animate-ticker whitespace-nowrap py-2.5">
        {[...display, ...display, ...display].map((p, i) => {
          const up = p.changePct >= 0
          const quoteAsset = markets.find((m) => m.symbol === p.symbol)?.quoteAsset || 'USD'
          return (
            <div key={i} className="flex items-center gap-2 px-6 text-sm">
              <span className="font-semibold text-white">{p.symbol.split('/')[0]}</span>
              <span className="font-mono text-slate-300">{p.price.toLocaleString(undefined, { maximumFractionDigits: p.price < 1 ? 4 : 2 })} {quoteAsset}</span>
              <span className={`flex items-center gap-0.5 font-medium ${up ? 'text-bull' : 'text-bear'}`}>
                {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {up ? '+' : ''}{p.changePct.toFixed(2)}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
