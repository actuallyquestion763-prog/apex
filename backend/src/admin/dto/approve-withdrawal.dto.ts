import { IsOptional, IsString, MinLength } from 'class-validator'

export class ApproveWithdrawalDto {
  @IsOptional()
  @IsString()
  reason?: string

  @IsString()
  @MinLength(1)
  confirmPassword!: string
}
