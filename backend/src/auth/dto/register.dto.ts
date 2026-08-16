import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class RegisterDto {
  @IsEmail()
  email!: string

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string
}
