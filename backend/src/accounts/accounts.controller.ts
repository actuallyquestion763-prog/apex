import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { AccountsService } from './accounts.service'
import { ConvertDto } from './dto/convert.dto'
import { SessionAuthGuard } from '../common/guards/session-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { IdempotencyKeyHeader } from '../common/decorators/idempotency-key.decorator'
import { IdempotencyService } from '../common/idempotency/idempotency.service'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { FINANCIAL_CREATE_THROTTLE } from '../common/rate-limits'

@Controller('accounts')
@UseGuards(SessionAuthGuard)
export class AccountsController {
  constructor(
    private readonly accountsService: AccountsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('me/summary')
  getMySummary(@CurrentUser() user: AuthenticatedUser) {
    return this.accountsService.getFinancialSummary(user.id)
  }

  // Currency-specific balance (Trade Experience checkpoint, Part 1) — the
  // Trade page uses this instead of /me/summary's USD-only cash figure so a
  // BTC/USDT order shows USDT availability, not an unrelated USD number.
  @Get('me/balance')
  getMyBalance(@CurrentUser() user: AuthenticatedUser, @Query('currency') currency?: string) {
    const normalized = (currency ?? 'USD').trim().toUpperCase().slice(0, 32) || 'USD'
    return this.accountsService.getCashBalance(user.id, normalized)
  }

  // Spot Holdings Visibility checkpoint — every currency the authenticated
  // user actually holds a non-zero balance in. Scoped to @CurrentUser()
  // only, exactly like every other /me/* route here — there is no
  // userId-accepting variant of this endpoint anywhere, so one user can
  // never request another's holdings.
  @Get('me/assets')
  getMyAssets(@CurrentUser() user: AuthenticatedUser) {
    return this.accountsService.listNonZeroAssetBalances(user.id)
  }

  @Get('me/ledger')
  getMyLedger(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    return this.accountsService.getLedgerHistory(user.id, limit ? Number(limit) : undefined)
  }

  // Currency conversion (Part 32) — same idempotency-key + rate-limit tier
  // as every other financial-creation endpoint (Orders, Options trades,
  // Deposits/Withdrawals).
  @Post('me/convert')
  @Throttle(FINANCIAL_CREATE_THROTTLE)
  convert(@CurrentUser() user: AuthenticatedUser, @Body() dto: ConvertDto, @IdempotencyKeyHeader() idempotencyKey?: string) {
    return this.idempotency.run(
      { userId: user.id, scope: 'accounts.convert', key: idempotencyKey, requestPayload: dto },
      () => this.accountsService.convert(user.id, dto),
    )
  }
}
