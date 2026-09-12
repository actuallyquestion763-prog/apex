import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator'

const MAX_GREETING_LENGTH = 2000

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

  // Support ticket auto-greeting (Customer Support redesign) — a real
  // message posted by an actual staff account the moment a customer opens
  // a new ticket, never a fabricated/bot sender. supportAutoGreetingSenderId
  // is validated against real ADMIN/SUPER_ADMIN accounts in
  // AdminService.updatePlatformSettings(), not here (this DTO only checks
  // shape, not whether the ID exists).
  @IsOptional()
  @IsBoolean()
  supportAutoGreetingEnabled?: boolean

  @IsOptional()
  @IsString()
  @MaxLength(MAX_GREETING_LENGTH)
  supportAutoGreetingMessage?: string

  @IsOptional()
  @IsString()
  supportAutoGreetingSenderId?: string

  @IsString()
  @MinLength(3)
  reason!: string

  @IsString()
  confirmPassword!: string
}
