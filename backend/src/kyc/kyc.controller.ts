import { Body, Controller, Get, Param, Post, StreamableFile, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { FileFieldsInterceptor } from '@nestjs/platform-express'
import { KycService, type SubmitKycFiles } from './kyc.service'
import { SubmitKycDto } from './dto/submit-kyc.dto'
import { SessionAuthGuard } from '../common/guards/session-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { MEDIA_UPLOAD_THROTTLE } from '../common/rate-limits'

@Controller('kyc')
@UseGuards(SessionAuthGuard)
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Post('submit')
  @Throttle(MEDIA_UPLOAD_THROTTLE)
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'front', maxCount: 1 },
    { name: 'back', maxCount: 1 },
  ]))
  submit(@CurrentUser() user: AuthenticatedUser, @Body() dto: SubmitKycDto, @UploadedFiles() files: SubmitKycFiles) {
    return this.kycService.submit(user.id, dto, files ?? {})
  }

  @Get('me')
  getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.kycService.getMine(user.id)
  }

  @Get('documents/:id')
  async getDocument(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const file = await this.kycService.getDocumentFile(user.id, id)
    return new StreamableFile(file.stream, { type: file.mimeType, disposition: `inline; filename="${encodeURIComponent(file.filename)}"` })
  }
}
