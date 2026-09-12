import { IsIn, IsString, MinLength } from 'class-validator'
import { Role } from '@prisma/client'

export class UpdateUserRoleDto {
  @IsIn(['USER', 'ADMIN', 'SUPER_ADMIN'])
  role!: Role

  @IsString()
  @MinLength(3)
  reason!: string

  @IsString()
  confirmPassword!: string
}
