import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator'

export class UpdateMarketConfigDto {
  @IsOptional()
  @IsBoolean()
  tradingEnabled?: boolean

  @IsOptional()
  @IsBoolean()
  maintenanceMode?: boolean

  @IsString()
  @MinLength(3)
  reason!: string
}
