import { Global, Module } from '@nestjs/common'
import { PrismaService } from './prisma.service'

// Global so every feature module can inject PrismaService without importing
// this module everywhere — the DB connection is a cross-cutting concern.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
