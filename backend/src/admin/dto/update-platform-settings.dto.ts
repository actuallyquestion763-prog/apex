import { IsBoolean, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator'

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

  // Phase 6F Checkpoint F, Part 6/9/15 — global open-orders-per-user cap.
  // Platform-wide financial-risk config, so this rides the SAME
  // step-up-gated endpoint as tradingEnabled etc. (confirmPassword below),
  // matching existing precedent rather than adding a new permission tier
  // for one more field.
  @IsOptional()
  @IsInt()
  @Min(1)
  maxOpenOrdersPerUser?: number

  @IsString()
  @MinLength(3)
  reason!: string

  @IsString()
  confirmPassword!: string
}
