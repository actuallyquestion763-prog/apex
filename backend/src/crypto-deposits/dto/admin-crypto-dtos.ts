import { IsBoolean, IsInt, IsNumberString, IsOptional, IsString, Min, MinLength } from 'class-validator'
import { Transform } from 'class-transformer'

// This DTO's fields arrive as multipart/form-data (the network-upsert route
// accepts an optional QR image alongside them — see
// crypto-deposits-admin.controller.ts), where every non-file field is a
// plain string regardless of its logical type — booleans/numbers need an
// explicit, precise coercion rather than relying on class-transformer's
// implicit conversion (which mishandles the string "false" as truthy).
const toOptionalBoolean = ({ value }: { value: unknown }) =>
  value === undefined || value === '' ? undefined : value === true || value === 'true'
const toOptionalInt = ({ value }: { value: unknown }) =>
  value === undefined || value === '' ? undefined : Number(value)

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
  @Transform(toOptionalBoolean)
  @IsBoolean()
  enabled?: boolean

  // Explicit null clears the minimum (same "not sent = unchanged, null =
  // clear it" convention as UpdateOptionMarketDto.maxInvestment). Multipart
  // form fields can't send a real `null`, so the frontend sends the literal
  // string "null" for "clear it" — handled in the service, not here.
  @IsOptional()
  @IsNumberString()
  minimumDeposit?: string

  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt()
  sortOrder?: number

  // Multipart form checkbox convention: sent as the string "true" only when
  // the admin explicitly wants to remove an existing QR image without
  // uploading a new one (a plain absent `qr` file means "leave it alone").
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  removeQr?: boolean

  @IsString()
  @MinLength(3)
  reason!: string

  @IsString()
  confirmPassword!: string
}
