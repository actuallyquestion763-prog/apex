import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { MarketDataSource } from '@prisma/client'

const GOLDAPI_URL = 'https://www.goldapi.io/api/XAU/USD'
const TTL_MS = 30_000

interface CachedQuote {
  price: number
  bid: number | null
  ask: number | null
  timestamp: number // provider unix seconds
}

// Same behavior as the existing server/market.js proxy (same TTL, same
// stale-on-failure fallback, same "never fabricate a price" rule), moved
// into the backend so it can eventually sit behind the same auth/rate
// limiting as everything else. MARKET_API_KEY is read from process.env
// here — same as before, never sent to the frontend. This module still only
// provides a QUOTE, not order execution — see markets.controller.ts.
@Injectable()
export class MarketsService {
  private readonly logger = new Logger('MarketsService')
  private lastValid: CachedQuote | null = null
  private lastFetch = 0

  constructor(private readonly prisma: PrismaService) {}

  async getXauQuote(): Promise<{ price: number; bid: number | null; ask: number | null; timestamp: string; source: string; stale: boolean } | { error: string; message: string }> {
    const apiKey = process.env.MARKET_API_KEY
    if (!apiKey) {
      return { error: 'market_api_key_missing', message: 'Market API key not configured on server' }
    }

    const now = Date.now()
    if (this.lastValid && now - this.lastFetch < TTL_MS) {
      return this.toResponse(this.lastValid, false)
    }

    try {
      const resp = await fetch(GOLDAPI_URL, { headers: { 'x-access-token': apiKey } })
      if (!resp.ok) throw new Error(`provider status ${resp.status}`)
      const body = await resp.json()

      const price = Number(body.price)
      const bid = body.bid != null ? Number(body.bid) : null
      const ask = body.ask != null ? Number(body.ask) : null
      const timestamp = body.timestamp ? Number(body.timestamp) : Math.floor(Date.now() / 1000)

      if (!Number.isFinite(price) || price <= 0) throw new Error('invalid price from provider')

      this.lastValid = { price, bid, ask, timestamp }
      this.lastFetch = Date.now()
      return this.toResponse(this.lastValid, false)
    } catch (err) {
      this.logger.warn(`GoldAPI fetch failed: ${err instanceof Error ? err.message : String(err)}`)
      if (this.lastValid) return this.toResponse(this.lastValid, true)
      return { error: 'market_unavailable', message: 'Market data unavailable' }
    }
  }

  private toResponse(q: CachedQuote, stale: boolean) {
    return {
      price: q.price,
      bid: q.bid,
      ask: q.ask,
      timestamp: new Date(q.timestamp * 1000).toISOString(),
      source: 'GoldAPI',
      stale,
    }
  }

  // --- Per-market configuration (server-enforced, not UI-only) -------------

  async listMarketConfigs() {
    return this.prisma.marketConfig.findMany({ orderBy: { symbol: 'asc' } })
  }

  async getMarketConfig(symbol: string) {
    const existing = await this.prisma.marketConfig.findUnique({ where: { symbol } })
    if (existing) return existing
    // Default a never-seen symbol to SIMULATED + trading disabled until an
    // admin explicitly configures it — fail closed, not open.
    return this.prisma.marketConfig.create({
      data: { symbol, dataSource: symbol === 'XAU/USD' ? MarketDataSource.LIVE : MarketDataSource.SIMULATED, tradingEnabled: false },
    })
  }

  async setMarketConfig(symbol: string, patch: Partial<{ tradingEnabled: boolean; maintenanceMode: boolean; dataSource: MarketDataSource }>) {
    await this.getMarketConfig(symbol)
    return this.prisma.marketConfig.update({ where: { symbol }, data: patch })
  }
}
