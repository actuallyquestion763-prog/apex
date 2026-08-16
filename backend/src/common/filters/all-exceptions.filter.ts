import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common'
import type { Response } from 'express'

// Never leaks stack traces, database error text, or other internals to the
// client. Known HttpExceptions (thrown deliberately, e.g. UnauthorizedException)
// pass their message through since those are already written to be
// user-safe; anything unexpected becomes a generic 500 message, with full
// detail logged server-side only.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter')

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const body = exception.getResponse()
      response.status(status).json(typeof body === 'string' ? { message: body } : body)
      return
    }

    this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : String(exception))
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Internal server error.' })
  }
}
