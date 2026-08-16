import { Module } from '@nestjs/common'
import { PositionsService } from './positions.service'
import { PositionsController } from './positions.controller'

@Module({
  providers: [PositionsService],
  controllers: [PositionsController],
})
export class PositionsModule {}
