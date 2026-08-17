import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class CreatePageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  slug!: string

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string

  // @IsArray() only confirms the shape survives the whitelist ValidationPipe
  // — the real validation (allowed section types, safe field values) happens
  // in CmsService via cms.validation.ts's validateSections(), not trusted
  // as-is just because it's an array.
  @IsArray()
  sections!: unknown[]

  @IsOptional()
  @IsString()
  @MaxLength(200)
  seoTitle?: string

  @IsOptional()
  @IsString()
  @MaxLength(300)
  seoDescription?: string
}

export class UpdatePageDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string

  @IsOptional()
  @IsArray()
  sections?: unknown[]

  @IsOptional()
  @IsString()
  @MaxLength(200)
  seoTitle?: string

  @IsOptional()
  @IsString()
  @MaxLength(300)
  seoDescription?: string

  @IsOptional()
  @IsString()
  @MinLength(3)
  reason?: string
}
