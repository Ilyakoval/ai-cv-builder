import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ApiErrorDto } from '@cvb/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * One error shape for the whole API. Unknown errors are logged with the
 * request id and returned as a generic 500 — internals never leak to clients.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpError');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    let body: ApiErrorDto;
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const obj = typeof res === 'string' ? { message: res } : (res as Record<string, unknown>);
      const message = Array.isArray(obj.message) ? String(obj.message[0]) : String(obj.message ?? exception.message);
      body = {
        statusCode: status,
        error: HttpStatus[status] ?? 'Error',
        message,
        ...(Array.isArray(obj.details) ? { details: obj.details as ApiErrorDto['details'] } : {}),
      };
    } else if (isFastifyError(exception)) {
      // e.g. body too large, multipart limits, rate limit
      const status = exception.statusCode;
      body = { statusCode: status, error: HttpStatus[status] ?? 'Error', message: exception.message };
    } else {
      this.logger.error(
        `Unhandled error on ${request.method} ${request.url} (req ${request.id})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      body = { statusCode: 500, error: 'InternalServerError', message: 'Something went wrong. Please try again.' };
    }

    void reply.status(body.statusCode).send(body);
  }
}

function isFastifyError(e: unknown): e is { statusCode: number; message: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as { statusCode?: unknown }).statusCode === 'number' &&
    (e as { statusCode: number }).statusCode >= 400 &&
    (e as { statusCode: number }).statusCode < 500
  );
}
