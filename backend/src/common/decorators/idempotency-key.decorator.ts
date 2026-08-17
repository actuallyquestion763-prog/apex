import { createParamDecorator, ExecutionContext } from '@nestjs/common'

// Reads the standard "Idempotency-Key" HTTP header. Optional — a request
// without it behaves exactly as before this mechanism existed (no dedup).
export const IdempotencyKeyHeader = createParamDecorator((_: unknown, ctx: ExecutionContext): string | undefined => {
  const request = ctx.switchToHttp().getRequest()
  const header = request.headers['idempotency-key']
  return Array.isArray(header) ? header[0] : header
})
