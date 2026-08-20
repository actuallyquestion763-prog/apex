import { IsBoolean, IsInt, IsNumberString, IsOptional, IsString, Min, MinLength } from 'class-validator'

export class CreateCryptoAssetDto {
  @IsString()
  symbol!: string

  @IsString()
  name!: string

  @IsOptional()
  @IsInt()
  sortOrder?: number
}

export class UpdateCryptoAssetDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsInt()
  sortOrder?: number
}

export class UpsertCryptoDepositAddressDto {
  @IsString()
  networkCode!: string

  @IsString()
  networkName!: string

  @IsString()
  receivingAddress!: string

  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  // Explicit null clears the minimum (same "not sent = unchanged, null =
  // clear it" convention as UpdateOptionMarketDto.maxInvestment).
  @IsOptional()
  @IsNumberString()
  minimumDeposit?: string

  @IsOptional()
  @IsInt()
  sortOrder?: number

  @IsString()
  @MinLength(3)
  reason!: string

  @IsString()
  confirmPassword!: string

  @IsString()
  totpCode!: string
}
