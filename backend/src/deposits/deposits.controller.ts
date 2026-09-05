import { Body, Controller, Get, Param, Post, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { FileInterceptor } from '@nestjs/platform-express'
import { DepositsService } from './deposits.service'
import { CreateDepositDto } from './dto/create-deposit.dto'
import { SessionAuthGuard } from '../common/guards/session-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { IdempotencyKeyHeader } from '../common/decorators/idempotency-key.decorator'
import { IdempotencyService } from '../common/idempotency/idempotency.service'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { FINANCIAL_CREATE_THROTTLE, MEDIA_UPLOAD_THROTTLE } from '../common/rate-limits'

interface UploadedFileLike {
  originalname: string
  mimetype: string
  buffer: Buffer
}

@Controller('deposits')
@UseGuards(SessionAuthGuard)
export class DepositsController {
  constructor(
    private readonly depositsService: DepositsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  @Throttle(FINANCIAL_CREATE_THROTTLE)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDepositDto, @IdempotencyKeyHeader() idempotencyKey?: string) {
    return this.idempotency.run(
      { userId: user.id, scope: 'deposits.create', key: idempotencyKey, requestPayload: dto },
      () => this.depositsService.createDeposit(user.id, dto),
    )
  }

  @Get('mine')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.depositsService.listMine(user.id)
  }

  // Separate multipart endpoint rather than folding into POST / (Part 20) —
  // keeps the create-deposit JSON body/idempotency-hash mechanism simple,
  // and mirrors the existing precedent of ticket creation vs. ticket
  // attachment being separate endpoints (see support.controller.ts).
  @Post(':id/proof')
  @Throttle(MEDIA_UPLOAD_THROTTLE)
  @UseInterceptors(FileInterceptor('file'))
  uploadProof(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @UploadedFile() file: UploadedFileLike) {
    return this.depositsService.uploadProof(user.id, id, file)
  }

  @Get(':id/proof')
  async getProof(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const file = await this.depositsService.getProofFile(user.id, false, id)
    return new StreamableFile(file.stream, { type: file.mimeType, disposition: `attachment; filename="${encodeURIComponent(file.filename)}"` })
  }
}
