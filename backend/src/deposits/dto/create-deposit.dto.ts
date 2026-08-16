import { IsNumberString, IsOptional, IsString } from 'class-validator'

export class CreateDepositDto {
  @IsNumberString()
  amount!: string

  @IsString()
  method!: string

  @IsOptional()
  @IsString()
  currency?: string
}
