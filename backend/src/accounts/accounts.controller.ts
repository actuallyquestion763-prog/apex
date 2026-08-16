import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { AccountsService } from './accounts.service'
import { SessionAuthGuard } from '../common/guards/session-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../common/types/authenticated-user'

@Controller('accounts')
@UseGuards(SessionAuthGuard)
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get('me/summary')
  getMySummary(@CurrentUser() user: AuthenticatedUser) {
    return this.accountsService.getFinancialSummary(user.id)
  }

  @Get('me/ledger')
  getMyLedger(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    return this.accountsService.getLedgerHistory(user.id, limit ? Number(limit) : undefined)
  }
}
