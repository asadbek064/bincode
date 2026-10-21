import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '../../shared/api.ts';

export class HttpError extends Error {
  readonly status: number;
  readonly details: ApiErrorBody['details'];

  constructor(status: number, message: string, details?: ApiErrorBody['details']) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, 'Not found'));
};

function zodDetails(err: ZodError): NonNullable<ApiErrorBody['details']> {
  return err.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  let status = 500;
  let body: ApiErrorBody = { error: 'Internal server error' };

  if (err instanceof HttpError) {
    status = err.status;
    body = { error: err.message };
    if (err.details) body.details = err.details;
  } else if (err instanceof ZodError) {
    status = 400;
    body = { error: 'Validation failed', details: zodDetails(err) };
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    body = { error: 'Request body too large' };
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    body = { error: 'Malformed JSON body' };
  } else if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500 && err.expose) {
    // Other body-parser / http-errors client errors (e.g. unsupported charset) are safe to surface.
    status = err.status;
    body = { error: err.message };
  } else {
    console.error(err);
  }

  res.status(status).json(body);
};
