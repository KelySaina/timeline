import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { HttpError } from '../lib/errors.js';

type Bucket = { count: number; resetAt: number };

/** Small in-process limiter: enough to blunt credential stuffing on a single-node MVP. */
export function rateLimit(options: { windowMs: number; max: number; key?: (req: Request) => string }) {
  const buckets = new Map<string, Bucket>();
  const keyOf = options.key ?? ((req: Request) => req.ip ?? 'unknown');

  return (req: Request, res: Response, next: NextFunction): void => {
    // The integration suite creates many accounts from one address; limits are enforced everywhere else.
    if (env.NODE_ENV === 'test') return next();
    const now = Date.now();
    const key = keyOf(req);
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      if (buckets.size > 5_000) {
        for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
      }
      return next();
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return next(new HttpError(429, 'Too many attempts — try again shortly', 'rate_limited'));
    }
    next();
  };
}
