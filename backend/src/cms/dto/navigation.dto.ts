import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateNavigationItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  label!: string

  // Validated against cms.validation.ts's validateDestination() in the
  // service — class-validator only confirms it's a non-empty string here.
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  destination!: string

  @IsOptional()
  @IsInt()
  order?: number
}

export class UpdateNavigationItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  label?: string

  @IsOptional()
  @IsString()
  @MaxLength(300)
  destination?: string

  @IsOptional()
  @IsInt()
  order?: number

  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}
