import { Module } from '@nestjs/common'
import { PlatformSettingsService } from './platform-settings.service'

@Module({
  providers: [PlatformSettingsService],
  exports: [PlatformSettingsService],
})
export class PlatformSettingsModule {}
