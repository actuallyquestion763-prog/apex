import { Controller, Get, UseGuards } from '@nestjs/common'
import { PositionsService } from './positions.service'
import { SessionAuthGuard } from '../common/guards/session-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../common/types/authenticated-user'

@Controller('positions')
@UseGuards(SessionAuthGuard)
export class PositionsController {
  constructor(private readonly positionsService: PositionsService) {}

  @Get('mine')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.positionsService.listAllForUser(user.id)
  }
}
