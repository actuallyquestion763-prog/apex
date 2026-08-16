import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { WithdrawalsService } from './withdrawals.service'
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto'
import { SessionAuthGuard } from '../common/guards/session-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../common/types/authenticated-user'

@Controller('withdrawals')
@UseGuards(SessionAuthGuard)
export class WithdrawalsController {
  constructor(private readonly withdrawalsService: WithdrawalsService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWithdrawalDto) {
    return this.withdrawalsService.createWithdrawal(user.id, dto)
  }

  @Get('mine')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.withdrawalsService.listMine(user.id)
  }
}
