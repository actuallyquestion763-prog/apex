import { IsString, MaxLength, MinLength } from 'class-validator'

// Same password rule as RegisterDto/ChangePasswordDto (Part 11) — password
// recovery must never accept a weaker password than any other path does.
export class ResetPasswordDto {
  @IsString()
  token!: string

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  newPassword!: string
}
