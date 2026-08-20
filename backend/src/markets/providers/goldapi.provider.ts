import { Injectable, Logger } from '@nestjs/common'
import type { MarketDataProvider, ProviderQuoteRequest, RawProviderQuote } from '../market-data.types'

// The only REAL external market-data provider connected in this phase
// (Phase 6B, Part 6/27) — GoldAPI, for XAU/USD. Ported from the previous
// markets.service.ts/server/market.js implementations, unchanged in
// substance (same URL shape, same header, same field mapping) — only the
// shape of what it returns changed, to satisfy the MarketDataProvider
// interface instead of returning an ad-hoc response object itself.
//
// `providerSymbol` (see MarketConfig.providerSymbol) is used as the path
// segment directly (GoldAPI's URL scheme is /api/{metal}/{currency}, e.g.
// "XAU/USD") — this makes the adapter reusable for any other GoldAPI metal
// pair (e.g. XAG/USD) purely via a new MarketConfig row, no code change.
const GOLDAPI_BASE = 'https://www.goldapi.io/api'

@Injectable()
export class GoldApiProvider implements MarketDataProvider {
  // Display label only — MarketDataService looks providers up by the
  // MarketConfig.provider column value ("GOLDAPI"), independent of this
  // string, which just flows through to MarketQuote.source for display.
  readonly name = 'GoldAPI'
  private readonly logger = new Logger('GoldApiProvider')

  async getQuote(request: ProviderQuoteRequest): Promise<RawProviderQuote> {
    const apiKey = process.env.MARKET_API_KEY
    if (!apiKey) {
      // Never logged with any hint of what a real key would look like —
      // this branch only ever fires when the env var is entirely absent.
      throw new Error('MARKET_API_KEY is not configured')
    }

    const url = `${GOLDAPI_BASE}/${request.providerSymbol}`
    const resp = await fetch(url, { headers: { 'x-access-token': apiKey } })
    if (!resp.ok) {
      // Distinguish the failure classes Part 16 asks for, without ever
      // including the API key (it's a request header, never in the URL or
      // body, so it can't leak into this message).
      if (resp.status === 401 || resp.status === 403) throw new Error(`GoldAPI authentication failed (${resp.status})`)
      if (resp.status === 429) throw new Error('GoldAPI rate limited (429)')
      if (resp.status >= 500) throw new Error(`GoldAPI server error (${resp.status})`)
      throw new Error(`GoldAPI request failed (${resp.status})`)
    }

    const body = await resp.json().catch(() => {
      throw new Error('GoldAPI returned a non-JSON response')
    })

    return {
      last: body.price != null ? Number(body.price) : null,
      bid: body.bid != null ? Number(body.bid) : null,
      ask: body.ask != null ? Number(body.ask) : null,
      timestampSeconds: body.timestamp != null ? Number(body.timestamp) : null,
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!process.env.MARKET_API_KEY) return false
    try {
      // A real health check without spending a real quote request would
      // need a dedicated GoldAPI status endpoint, which it doesn't offer —
      // presence of the credential is the only thing checkable without
      // making the same call getQuote() already makes.
      return true
    } catch {
      return false
    }
  }
}
