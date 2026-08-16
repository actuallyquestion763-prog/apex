import { Module } from '@nestjs/common'
import { AuthService } from './auth.service'
import { AuthController } from './auth.controller'
import { AuditModule } from '../audit/audit.module'
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module'
import { UsersModule } from '../users/users.module'

@Module({
  imports: [AuditModule, PlatformSettingsModule, UsersModule],
  providers: [AuthService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
