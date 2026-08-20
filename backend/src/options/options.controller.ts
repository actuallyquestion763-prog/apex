import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { OptionsService } from './options.service'
import { OptionsMarketService } from './options-market.service'
import { CreateOptionTradeDto } from './dto/create-option-trade.dto'
import { SessionAuthGuard } from '../common/guards/session-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { IdempotencyKeyHeader } from '../common/decorators/idempotency-key.decorator'
import { IdempotencyService } from '../common/idempotency/idempotency.service'
import { AccountsService } from '../accounts/accounts.service'
import { LedgerService } from '../ledger/ledger.service'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { FINANCIAL_CREATE_THROTTLE } from '../common/rate-limits'

@Controller('options')
@UseGuards(SessionAuthGuard)
export class OptionsController {
  constructor(
    private readonly optionsService: OptionsService,
    private readonly optionsMarkets: OptionsMarketService,
    private readonly idempotency: IdempotencyService,
    private readonly accounts: AccountsService,
    private readonly ledger: LedgerService,
  ) {}

  // Public-to-any-signed-in-user configuration read (Part 1/4/5) — the
  // trading UI's only source of which assets/durations/payouts are
  // currently offered. Never hardcoded in React.
  @Get('markets')
  listMarkets() {
    return this.optionsMarkets.listEnabledMarkets()
  }

  // Per-currency available balance — the existing GET /accounts/me/summary
  // always reports the USD balance only, but an OptionMarket's stake
  // currency (e.g. USDT) may differ, so the options UI needs its own
  // currency-aware read rather than assuming USD. Read-only, reuses
  // LedgerService.getAccountBalances() exactly as every other balance
  // check in this codebase does — never a separate balance mechanism.
  @Get('balance')
  async getBalance(@CurrentUser() user: AuthenticatedUser, @Query('currency') currency = 'USDT') {
    const account = await this.accounts.getPrimaryAccount(user.id)
    const balances = await this.ledger.getAccountBalances(account.id, currency)
    return { currency, cash: balances.cash.toString(), reserved: balances.reserved.toString() }
  }

  @Post('trades')
  @Throttle(FINANCIAL_CREATE_THROTTLE)
  createTrade(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOptionTradeDto, @IdempotencyKeyHeader() idempotencyKey?: string) {
    return this.idempotency.run(
      { userId: user.id, scope: 'options.create', key: idempotencyKey, requestPayload: dto },
      () => this.optionsService.createTrade(user.id, dto),
    )
  }

  @Get('trades/active')
  listActive(@CurrentUser() user: AuthenticatedUser) {
    return this.optionsService.listMyActiveTrades(user.id)
  }

  // Trade history with filtering (Part 19).
  @Get('trades/mine')
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query('symbol') symbol?: string,
    @Query('result') result?: 'WIN' | 'LOSS' | 'DRAW',
    @Query('active') active?: string,
    @Query('completed') completed?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.optionsService.listMyTrades(user.id, {
      symbol,
      result,
      activeOnly: active === 'true',
      completedOnly: completed === 'true',
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    })
  }

  // A single trade, opportunistically settled on read if its expiry has
  // already passed (Part 20 — the active trade must survive a refresh, and
  // should not visibly "hang" waiting on the next sweep tick).
  @Get('trades/:id')
  getTrade(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.optionsService.getTrade(user.id, id)
  }
}
