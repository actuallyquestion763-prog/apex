import { Module } from '@nestjs/common'
import { ExecutionModule } from './execution.module'
import { ExecutionStatusController } from './execution-status.controller'

// Deliberately separate from ExecutionModule itself: that module is kept
// dependency-light/infrastructure-only (see its own doc comment) and is
// unit-tested in isolation via `Test.createTestingModule({ imports:
// [ExecutionModule] })` (execution.module.spec.ts) with no PrismaModule in
// scope — adding an authenticated controller (SessionAuthGuard needs
// PrismaService) directly to ExecutionModule would break that isolation.
// PrismaModule is @Global(), so it doesn't need to be imported here
// explicitly once this module is part of the real AppModule graph.
@Module({
  imports: [ExecutionModule],
  controllers: [ExecutionStatusController],
})
export class ExecutionStatusModule {}
