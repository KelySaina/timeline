import type { NextFunction, Request, Response } from 'express';
import { queryOne } from '../db/pool.js';
import { unauthorized } from '../lib/errors.js';
import { CSRF_COOKIE, SESSION_COOKIE } from '../lib/http.js';
import { readSessionToken } from '../lib/token.js';
import type { AuthUser } from '../types.js';

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  birthday: string | null;
  avatar_key: string | null;
  token_version: number;
};

/** Attaches req.user when a valid session cookie is present. Never rejects. */
export async function loadSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const claims = readSessionToken(req.cookies?.[SESSION_COOKIE]);
    if (!claims) return next();

    const row = await queryOne<UserRow>(
      'select id, email, display_name, birthday, avatar_key, token_version from users where id = $1',
      [claims.sub],
    );
    // token_version mismatch = the session was revoked (password change, sign-out-everywhere).
    if (!row || row.token_version !== claims.tv) return next();

    req.user = {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      birthday: row.birthday,
      avatarKey: row.avatar_key,
      tokenVersion: row.token_version,
    } satisfies AuthUser;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireUser(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Double-submit CSRF: the cookie value must be echoed in the X-CSRF-Token header. */
export function verifyCsrf(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get('x-csrf-token');
  if (!cookie || !header || cookie !== header) {
    return next(unauthorized('Your session expired — please sign in again.'));
  }
  next();
}
