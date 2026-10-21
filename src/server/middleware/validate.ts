import type { RequestHandler } from 'express';
import type { z } from 'zod';

export function validateBody(schema: z.ZodType): RequestHandler {
  return (req, _res, next) => {
    // Without a JSON content-type express.json() leaves body undefined; validate it as empty.
    req.body = schema.parse(req.body ?? {});
    next();
  };
}
