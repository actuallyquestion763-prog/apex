import { IsBoolean, IsIn, IsInt, IsNumberString, IsOptional, IsString, Min, MinLength } from 'class-validator'

export class CreateOptionMarketDto {
  @IsString()
  symbol!: string

  @IsOptional()
  @IsString()
  currency?: string

  @IsOptional()
  @IsNumberString()
  minInvestment?: string

  @IsOptional()
  @IsNumberString()
  maxInvestment?: string
}

export class UpdateOptionMarketDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @IsOptional()
  @IsString()
  currency?: string

  @IsOptional()
  @IsNumberString()
  minInvestment?: string

  // Explicit null clears the maximum (no ceiling beyond platform-wide
  // limits) — distinguishing "not sent" (undefined, leave unchanged) from
  // "clear it" (null) the same way UpdatePlatformSettingsDto-adjacent
  // optional-numeric fields already do elsewhere in this codebase.
  @IsOptional()
  maxInvestment?: string | null
}

export class UpsertOptionDurationDto {
  @IsInt()
  @Min(1)
  durationSeconds!: number

  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @IsNumberString()
  payoutPercent!: string
}

export class UpdateOptionsSettingsDto {
  @IsOptional()
  @IsBoolean()
  tradingEnabled?: boolean

  @IsOptional()
  @IsInt()
  @Min(1)
  maxActiveTradesPerUser?: number

  @IsOptional()
  @IsNumberString()
  maxExposurePerUser?: string

  // Trade Experience checkpoint, Part 8 — platform-wide sandbox test-outcome
  // dial. Validated here as a normal enum value; the environment gate (only
  // ever settable to non-RANDOM in development/test) is enforced in
  // OptionsAdminController, not here — DTO validation only checks shape.
  @IsOptional()
  @IsIn(['RANDOM', 'FORCE_WIN', 'FORCE_LOSS'])
  sandboxOutcomeMode?: 'RANDOM' | 'FORCE_WIN' | 'FORCE_LOSS'

  @IsString()
  @MinLength(3)
  reason!: string

  @IsString()
  confirmPassword!: string

  @IsString()
  totpCode!: string
}
