import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator'

export class UpdatePlatformSettingsDto {
  @IsOptional()
  @IsBoolean()
  tradingEnabled?: boolean

  @IsOptional()
  @IsBoolean()
  depositsEnabled?: boolean

  @IsOptional()
  @IsBoolean()
  withdrawalsEnabled?: boolean

  @IsOptional()
  @IsBoolean()
  registrationsEnabled?: boolean

  @IsString()
  @MinLength(3)
  reason!: string

  @IsString()
  confirmPassword!: string

  @IsString()
  totpCode!: string
}
