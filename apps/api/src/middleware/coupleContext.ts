import type { NextFunction, Request, Response } from 'express';
import { queryOne } from '../db/pool.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import type { CoupleContext } from '../types.js';

type Row = {
  id: string;
  title: string | null;
  started_on: string | null;
  theme: string;
  role: 'owner' | 'partner';
};

/**
 * Resolves the caller's active couple *from the session* and pins it to req.couple.
 * No route anywhere accepts a couple id from the client — that is the whole point.
 */
export async function loadCouple(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    // Tolerant on purpose: anonymous requests just get no couple; requireCouple does the rejecting.
    if (!req.user) return next();
    const row = await queryOne<Row>(
      `select c.id, c.title, c.started_on, c.theme, m.role
         from couple_members m
         join couples c on c.id = m.couple_id
        where m.user_id = $1 and m.left_at is null`,
      [req.user.id],
    );
    if (row) {
      req.couple = {
        id: row.id,
        role: row.role,
        title: row.title,
        startedOn: row.started_on,
        theme: row.theme,
      } satisfies CoupleContext;
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requireCouple(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  if (!req.couple) return next(forbidden('Create or join a relationship first'));
  next();
}
