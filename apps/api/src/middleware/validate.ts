import type { NextFunction, Request, Response } from 'express';
import type { ZodType, z } from 'zod';
import { badRequest } from '../lib/errors.js';

type Source = 'body' | 'query' | 'params';

/**
 * Validates one request source and parks the parsed result on req.valid.
 * Handlers read from there (never from the raw source), so no handler ever sees
 * uncoerced input and Express cannot reset it while walking the router stack.
 */
export function validate<S extends ZodType>(schema: S, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return next(badRequest('Some fields need a second look', details));
    }
    req.valid = { ...req.valid, [source]: result.data };
    if (source === 'body') req.body = result.data;
    next();
  };
}

/** Typed accessor for whatever validate() parsed. */
export function valid<T>(req: Request, source: Source): T {
  return req.valid?.[source] as T;
}

export type Validated<S extends ZodType> = z.output<S>;
