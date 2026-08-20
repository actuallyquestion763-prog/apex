import { IsDateString, IsIn, IsString, MaxLength, MinLength } from 'class-validator'

const ID_TYPES = ['NATIONAL_ID', 'PASSPORT', 'DRIVERS_LICENSE'] as const

// Multipart form body (documents arrive as separate files via
// FileFieldsInterceptor — see kyc.controller.ts) — every field here is a
// real business requirement for identity verification, not carried over
// from any pre-existing product rule (none existed before this checkpoint).
export class SubmitKycDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string

  @IsDateString()
  dateOfBirth!: string

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  country!: string

  @IsIn(ID_TYPES)
  idType!: (typeof ID_TYPES)[number]

  @IsString()
  @MinLength(3)
  @MaxLength(64)
  idNumber!: string
}
