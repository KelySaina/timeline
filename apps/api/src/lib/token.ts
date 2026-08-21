import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

export type SessionClaims = { sub: string; tv: number; exp: number };

const b64 = (input: Buffer | string) => Buffer.from(input).toString('base64url');

function sign(payload: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(payload).digest('base64url');
}

/** Compact HMAC-signed session token. Stateless, revocable through users.token_version. */
export function issueSessionToken(userId: string, tokenVersion: number, ttlSeconds: number): string {
  const claims: SessionClaims = {
    sub: userId,
    tv: tokenVersion,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payload = b64(JSON.stringify(claims));
  return `${payload}.${sign(payload)}`;
}

export function readSessionToken(token: string | undefined): SessionClaims | null {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionClaims;
    if (!claims.sub || typeof claims.exp !== 'number') return null;
    if (claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Invite codes people read aloud: Crockford-ish base32, no I/L/O/U. */
export function inviteCode(length = 10): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const raw = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[raw[i]! % alphabet.length];
  return out;
}
