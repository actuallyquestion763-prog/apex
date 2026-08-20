import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { MarketDataSource } from '@prisma/client'
import { MarketDataService } from './market-data.service'

// Instrument CONFIGURATION (enabled/trading/maintenance state, precision,
// provider mapping) — kept separate from MarketDataService, which owns
// live QUOTES (Part 2's Instrument vs MarketQuote split). OrdersService and
// AdminService depend on the config methods here; the quote methods are a
// thin, stable facade over MarketDataService so neither of those two
// callers needed to change their dependency graph this phase.
@Injectable()
export class MarketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketData: MarketDataService,
  ) {}

  // ---- Live quotes (delegates to MarketDataService) --------------------------

  getQuote(symbol: string) {
    return this.marketData.getQuote(symbol)
  }

  getQuotes(symbols: string[]) {
    return this.marketData.getQuotes(symbols)
  }

  // ---- Per-market configuration (server-enforced, not UI-only) ---------------

  async listMarketConfigs() {
    return this.prisma.marketConfig.findMany({ orderBy: { symbol: 'asc' } })
  }

  async getMarketConfig(symbol: string) {
    const existing = await this.prisma.marketConfig.findUnique({ where: { symbol } })
    if (existing) return existing
    // Default a never-seen symbol to SIMULATED + trading disabled + no
    // provider until an admin explicitly configures it — fail closed, not
    // open. Unchanged behavior from before this phase.
    return this.prisma.marketConfig.create({
      data: { symbol, dataSource: symbol === 'XAU/USD' ? MarketDataSource.LIVE : MarketDataSource.SIMULATED, tradingEnabled: false },
    })
  }

  async setMarketConfig(
    symbol: string,
    patch: Partial<{
      tradingEnabled: boolean
      maintenanceMode: boolean
      dataSource: MarketDataSource
      enabled: boolean
      // Phase 6F Checkpoint F, Part 6/15 — pre-trade risk engine limits,
      // admin-configurable per market. String in (Decimal precision, see
      // UpdateMarketConfigDto), Decimal-typed column out.
      minimumQuantity: string
      maximumQuantity: string
      maxOrderNotional: string
      maxPositionQuantity: string
    }>,
  ) {
    await this.getMarketConfig(symbol)
    return this.prisma.marketConfig.update({ where: { symbol }, data: patch })
  }
}
