import { IsNumberString, IsOptional, IsString } from 'class-validator'

export class CreateWithdrawalDto {
  @IsNumberString()
  amount!: string

  @IsString()
  destination!: string

  @IsOptional()
  @IsString()
  currency?: string
}
