import { IsString, MinLength } from 'class-validator'

export class ResetAdminPasswordDto {
  @IsString()
  @MinLength(12)
  newPassword!: string

  @IsString()
  @MinLength(5)
  reason!: string

  @IsString()
  confirmPassword!: string

  @IsString()
  totpCode!: string
}
