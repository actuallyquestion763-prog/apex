import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common'
import type { Request, Response } from 'express'
import { tap } from 'rxjs/operators'

// Checkpoint I.1, Part 5 — the structured-logging foundation. One JSON line
// per request, logged once the response has actually been sent (success OR
// error — AllExceptionsFilter already runs before this interceptor's tap
// callback fires, so statusCode always reflects the real outcome).
//
// Deliberately excludes the request body and every header except what's
// already public in the URL — the request body is where a password,
// confirmPassword, totpCode, or deposit/withdrawal amount lives, and there
// is no operational need to log any of it. Route params ARE logged (order
// id, withdrawal id, etc.) since those are opaque identifiers, not secrets,
// and are exactly what an operator needs to correlate a log line with a
// specific financial object.
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP')

  intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp()
    const req = http.getRequest<Request & { requestId?: string }>()
    const res = http.getResponse<Response>()
    const start = Date.now()

    const emit = () => {
      const entry: Record<string, unknown> = {
        requestId: req.requestId ?? 'unknown',
        method: req.method,
        path: req.route?.path ?? req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
        environment: process.env.NODE_ENV ?? 'development',
      }
      const resourceId = (req.params as Record<string, string> | undefined)?.id
      if (resourceId) entry.resourceId = resourceId
      this.logger.log(JSON.stringify(entry))
    }

    return next.handle().pipe(tap({ next: emit, error: emit }))
  }
}
