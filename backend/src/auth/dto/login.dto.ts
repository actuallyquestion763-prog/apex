import { IsEmail, IsString, MaxLength } from 'class-validator'

export class LoginDto {
  @IsEmail()
  email!: string

  @IsString()
  @MaxLength(200)
  password!: string
}
