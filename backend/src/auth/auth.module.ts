import { Module } from '@nestjs/common'
import { AuthService } from './auth.service'
import { AuthController } from './auth.controller'
import { AuditModule } from '../audit/audit.module'
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module'
import { UsersModule } from '../users/users.module'
import { EmailModule } from '../email/email.module'

@Module({
  imports: [AuditModule, PlatformSettingsModule, UsersModule, EmailModule],
  providers: [AuthService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
