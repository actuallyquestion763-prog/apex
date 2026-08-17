import { IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateFaqDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  question!: string

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  answer!: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string

  @IsOptional()
  @IsInt()
  order?: number
}

export class UpdateFaqDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  question?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  answer?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string

  @IsOptional()
  @IsInt()
  order?: number

  @IsOptional()
  @IsString()
  @MinLength(3)
  reason?: string
}
