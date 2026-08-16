import { IsOptional, IsString, MaxLength } from 'class-validator'

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fullName?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string
}
