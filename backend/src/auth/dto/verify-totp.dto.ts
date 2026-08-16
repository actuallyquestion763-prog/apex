import { IsString, Length } from 'class-validator'

export class VerifyTotpDto {
  @IsString()
  @Length(6, 6)
  code!: string
}
