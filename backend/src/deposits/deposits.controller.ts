import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { DepositsService } from './deposits.service'
import { CreateDepositDto } from './dto/create-deposit.dto'
import { SessionAuthGuard } from '../common/guards/session-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { IdempotencyKeyHeader } from '../common/decorators/idempotency-key.decorator'
import { IdempotencyService } from '../common/idempotency/idempotency.service'
import type { AuthenticatedUser } from '../common/types/authenticated-user'

@Controller('deposits')
@UseGuards(SessionAuthGuard)
export class DepositsController {
  constructor(
    private readonly depositsService: DepositsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDepositDto, @IdempotencyKeyHeader() idempotencyKey?: string) {
    return this.idempotency.run(
      { userId: user.id, scope: 'deposits.create', key: idempotencyKey, requestPayload: dto },
      () => this.depositsService.createDeposit(user.id, dto),
    )
  }

  @Get('mine')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.depositsService.listMine(user.id)
  }
}
