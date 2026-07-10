import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException } from '@nestjs/common';
import { DomainProblem } from '@social/domain';
import type { Request, Response } from 'express';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const requestId = request.header('x-request-id') ?? 'unknown';

    if (exception instanceof DomainProblem) {
      const { definition } = exception;
      response
        .status(definition.status)
        .type('application/problem+json')
        .json({
          type: `https://social-publisher.dev/problems/${definition.code}`,
          title: definition.messageKey,
          status: definition.status,
          detail: exception.message,
          instance: request.originalUrl,
          code: definition.code,
          requestId,
          action: definition.action,
          retryable: definition.retryable,
        });
      return;
    }

    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const code =
      status === 401
        ? 'auth.unauthorized'
        : status === 403
          ? 'auth.forbidden'
          : status === 500
            ? 'internal.unexpected'
            : 'http.error';
    response
      .status(status)
      .type('application/problem+json')
      .json({
        type: `https://social-publisher.dev/problems/${code}`,
        title:
          status === 401
            ? 'errors.authenticationRequired'
            : status === 403
              ? 'errors.permissionDenied'
              : status === 500
                ? 'errors.internal'
                : 'errors.http',
        status,
        detail:
          status === 401
            ? 'Authentication is required'
            : status === 403
              ? 'Permission denied'
              : status === 500
                ? 'An unexpected error occurred'
                : 'The request could not be completed',
        instance: request.originalUrl,
        code,
        requestId,
      });
  }
}
