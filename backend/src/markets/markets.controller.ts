import { Controller, Get } from '@nestjs/common'
import { MarketsService } from './markets.service'

@Controller('markets')
export class MarketsController {
  constructor(private readonly marketsService: MarketsService) {}

  // Mirrors the existing GET /market/xau contract from server/market.js —
  // market data is intentionally public (it's a quote, not an account
  // action), unlike everything else in this backend.
  @Get('xau')
  getXau() {
    return this.marketsService.getXauQuote()
  }

  @Get('config')
  listConfigs() {
    return this.marketsService.listMarketConfigs()
  }
}
