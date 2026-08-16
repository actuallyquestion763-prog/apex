import { IsIn, IsString, MinLength } from 'class-validator'
import { AccountStatus } from '@prisma/client'

export class UpdateUserStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED', 'RESTRICTED', 'PENDING_VERIFICATION', 'CLOSED'])
  status!: AccountStatus

  @IsString()
  @MinLength(3)
  reason!: string
}
