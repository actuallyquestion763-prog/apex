import { Injectable } from '@nestjs/common'
import type { MarketDataProvider, ProviderQuoteRequest, RawProviderQuote } from '../market-data.types'

// Explicitly-labeled demo/test data source (Phase 6B, Part 3/24) — no real
// crypto exchange is connected in this project (see Part 27: only GoldAPI
// exists as a real, configured provider). This is the SAME random-walk
// algorithm the frontend previously ran entirely client-side
// (src/store/priceFeed.ts, before this phase) — relocated here so it goes
// through the identical MarketDataProvider/validation/caching pipeline as a
// real provider, and so the DATABASE (not a hardcoded frontend array) is
// the source of truth for which symbols exist (Part 4). The quote this
// returns is ALWAYS reported with status SIMULATED, never LIVE — enforced
// by MarketDataService, not by this class (a provider adapter doesn't get
// to decide its own trust level).
//
// Starting prices match the values the frontend previously hardcoded in
// SYMBOLS — not new numbers invented for this phase.
const STARTING_PRICES: Record<string, number> = {
  'BTCUSDT': 67250,
  'ETHUSDT': 3480,
  'USDTUSD': 1.0,
  'XRPUSDT': 0.612,
  'SOLUSDT': 168,
  'BNBUSDT': 595,
  'ADAUSDT': 0.45,
  'DOGEUSDT': 0.158,
}

@Injectable()
export class SimulatedProvider implements MarketDataProvider {
  readonly name = 'SIMULATED'
  private readonly priceState = new Map<string, number>()

  async getQuote(request: ProviderQuoteRequest): Promise<RawProviderQuote> {
    const key = request.providerSymbol
    const current = this.priceState.get(key) ?? STARTING_PRICES[key]
    if (current === undefined) {
      throw new Error(`No simulated starting price configured for "${key}"`)
    }
    // Same bounded random-walk formula as the pre-Phase-6B frontend
    // implementation — small volatility, floor at a tiny positive value so
    // it can never wander to zero/negative.
    const volatility = current * 0.0015
    const drift = (Math.random() - 0.5) * 2 * volatility
    const next = Math.max(0.0001, current + drift)
    this.priceState.set(key, next)

    return {
      last: next,
      bid: next * 0.9995,
      ask: next * 1.0005,
      timestampSeconds: Math.floor(Date.now() / 1000),
    }
  }

  async healthCheck(): Promise<boolean> {
    return true // always available — nothing external to fail
  }
}
