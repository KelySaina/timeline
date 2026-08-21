import type { CookieOptions, Response } from 'express';
import { env, isProd } from '../config/env.js';

export const SESSION_COOKIE = 'tl_session';
export const CSRF_COOKIE = 'tl_csrf';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

const base: CookieOptions = {
  sameSite: 'lax',
  secure: env.COOKIE_SECURE || isProd,
  path: '/',
};

export function setSessionCookies(res: Response, token: string, csrf: string): void {
  res.cookie(SESSION_COOKIE, token, { ...base, httpOnly: true, maxAge: SESSION_TTL_SECONDS * 1000 });
  // Readable by the SPA on purpose: it echoes the value back in X-CSRF-Token (double submit).
  res.cookie(CSRF_COOKIE, csrf, { ...base, httpOnly: false, maxAge: SESSION_TTL_SECONDS * 1000 });
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { ...base, httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { ...base, httpOnly: false });
}
