import { IsBoolean, IsInt, IsOptional, IsString, IsUrl, MinLength } from 'class-validator'
import { Transform } from 'class-transformer'

// Both routes accept an optional icon file alongside these fields (see
// admin-contacts-admin.controller.ts's FileInterceptor('icon')), so the
// request always arrives as multipart/form-data — every non-file field is a
// plain string regardless of its logical type, same reasoning as
// UpsertCryptoDepositAddressDto in crypto-deposits/dto/admin-crypto-dtos.ts.
const toOptionalBoolean = ({ value }: { value: unknown }) =>
  value === undefined || value === '' ? undefined : value === true || value === 'true'
const toOptionalInt = ({ value }: { value: unknown }) =>
  value === undefined || value === '' ? undefined : Number(value)

export class CreateAdminContactDto {
  @IsString()
  @MinLength(1)
  name!: string

  @IsUrl({ require_tld: false })
  url!: string

  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt()
  sortOrder?: number

  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  enabled?: boolean
}

export class UpdateAdminContactDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string

  @IsOptional()
  @IsUrl({ require_tld: false })
  url?: string

  @IsOptional()
  @Transform(toOptionalInt)
  @IsInt()
  sortOrder?: number

  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  enabled?: boolean
}
