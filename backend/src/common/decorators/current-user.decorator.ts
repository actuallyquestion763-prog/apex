import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { AuthenticatedUser } from '../types/authenticated-user'

// Pulls the authenticated user attached to the request by SessionAuthGuard.
// Never trust a userId from the request body/query for authorization
// decisions — always use this.
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const request = ctx.switchToHttp().getRequest()
  return request.user
})
