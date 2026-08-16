import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { IsOptional, IsString } from 'class-validator'
import { KycService } from './kyc.service'
import { SessionAuthGuard } from '../common/guards/session-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../common/types/authenticated-user'

class SubmitKycDto {
  @IsOptional()
  @IsString()
  providerReference?: string
}

@Controller('kyc')
@UseGuards(SessionAuthGuard)
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Post('submit')
  submit(@CurrentUser() user: AuthenticatedUser, @Body() dto: SubmitKycDto) {
    return this.kycService.submit(user.id, dto.providerReference)
  }
}
