import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requireUser, verifyCsrf } from '../../middleware/session.js';
import { valid, validate } from '../../middleware/validate.js';
import { clearSessionCookies, setSessionCookies, SESSION_TTL_SECONDS } from '../../lib/http.js';
import { issueSessionToken, randomToken } from '../../lib/token.js';
import { getCoupleSnapshot, refreshDerivedForUser } from '../couples/couples.service.js';
import { avatarUpload, storeAvatar } from '../photos/photos.service.js';
import { notFound } from '../../lib/errors.js';
import { ObjectNotFound, readObject } from '../photos/storage/index.js';
import * as service from './auth.service.js';
import type { AuthUser } from '../../types.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date');

const credentials = z.object({
  email: z.string().email('That email looks off').max(160),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
});

const signupSchema = credentials.extend({
  displayName: z.string().trim().min(1, 'Tell us your name').max(60),
});

const profileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(60).optional(),
    birthday: isoDate.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const publicUser = (user: AuthUser) => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  birthday: user.birthday,
  hasAvatar: Boolean(user.avatarKey),
});

async function startSession(res: import('express').Response, user: AuthUser) {
  const csrf = randomToken(18);
  setSessionCookies(res, issueSessionToken(user.id, user.tokenVersion, SESSION_TTL_SECONDS), csrf);
  return { user: publicUser(user), couple: await getCoupleSnapshot(user.id), csrfToken: csrf };
}

export const authRouter = Router();

authRouter.post(
  '/auth/signup',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }),
  validate(signupSchema),
  async (req, res) => {
    const user = await service.signup(req.body);
    res.status(201).json(await startSession(res, user));
  },
);

authRouter.post(
  '/auth/login',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 12 }),
  validate(credentials),
  async (req, res) => {
    const user = await service.login(req.body);
    res.json(await startSession(res, user));
  },
);

authRouter.post('/auth/logout', (_req, res) => {
  clearSessionCookies(res);
  res.status(204).end();
});

/** Single bootstrap call: who am I, and what is my relationship. */
authRouter.get('/session', async (req, res) => {
  if (!req.user) return res.json({ user: null, couple: null });
  res.json({
    user: publicUser(req.user),
    couple: await getCoupleSnapshot(req.user.id),
  });
});

authRouter.patch('/me', requireUser, verifyCsrf, validate(profileSchema), async (req, res) => {
  const user = await service.updateProfile(req.user!.id, req.body);
  // A changed birthday must move the derived reminder with it.
  if (req.body.birthday !== undefined) await refreshDerivedForUser(user.id);
  res.json({ user: publicUser(user) });
});

authRouter.post('/me/avatar', requireUser, verifyCsrf, avatarUpload, async (req, res) => {
  const key = await storeAvatar(req.user!.id, req.file);
  const user = await service.setAvatarKey(req.user!.id, key);
  res.json({ user: publicUser(user) });
});

authRouter.get(
  '/users/:id/avatar',
  requireUser,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  async (req, res) => {
    const key = await service.avatarKeyVisibleTo(req.user!.id, valid<{ id: string }>(req, 'params').id);
    if (!key) throw notFound('No avatar here');
    const object = await readObject(key).catch((error: unknown) => {
      if (error instanceof ObjectNotFound) throw notFound('No avatar here');
      throw error;
    });
    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'private, max-age=300');
    if (object.contentLength) res.set('Content-Length', String(object.contentLength));
    object.stream.on('error', () => res.destroy());
    object.stream.pipe(res);
  },
);
