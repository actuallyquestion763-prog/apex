import { IsString, MinLength } from 'class-validator'

// The permission key itself comes from the URL path param
// (admins/:id/permissions/:permission/grant), validated against PERMISSIONS
// in AdminService.grantPermission via Prisma's findUniqueOrThrow — not part
// of this body DTO, to avoid requiring/validating the same value twice.
export class GrantPermissionDto {
  @IsString()
  @MinLength(3)
  reason!: string

  @IsString()
  confirmPassword!: string
}
