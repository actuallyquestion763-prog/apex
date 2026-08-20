import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { ExecutionModule } from '../execution/execution.module'
import { HealthController } from './health.controller'

@Module({
  imports: [PrismaModule, ExecutionModule],
  controllers: [HealthController],
})
export class HealthModule {}
