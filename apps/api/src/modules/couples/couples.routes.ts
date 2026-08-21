import { Router } from 'express';
import { z } from 'zod';
import { forbidden, notFound } from '../../lib/errors.js';
import { requireCouple } from '../../middleware/coupleContext.js';
import { requireUser, verifyCsrf } from '../../middleware/session.js';
import { valid, validate } from '../../middleware/validate.js';
import * as service from './couples.service.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date');

const createSchema = z.object({
  title: z.string().trim().max(80).nullish(),
  startedOn: isoDate.nullish(),
});

const updateSchema = z
  .object({
    title: z.string().trim().max(80).nullable().optional(),
    startedOn: isoDate.nullable().optional(),
    theme: z.enum(['dawn', 'bloom', 'linen', 'dusk', 'ink', 'midnight']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const codeSchema = z.object({ code: z.string().trim().min(6).max(24) });

export const couplesRouter = Router();

couplesRouter.post('/couples', requireUser, verifyCsrf, validate(createSchema), async (req, res) => {
  await service.createCouple(req.user!.id, req.body);
  res.status(201).json({ couple: await service.getCoupleSnapshot(req.user!.id) });
});

couplesRouter.get('/couples/me', requireUser, requireCouple, async (req, res) => {
  const couple = await service.getCoupleSnapshot(req.user!.id);
  if (!couple) throw notFound('No relationship yet');
  res.json({
    couple,
    invitation: couple.members.length < 2 ? await service.activeInvitation(couple.id) : null,
  });
});

couplesRouter.patch(
  '/couples/me',
  requireUser,
  requireCouple,
  verifyCsrf,
  validate(updateSchema),
  async (req, res) => {
    await service.updateCouple(req.couple!.id, req.body);
    res.json({ couple: await service.getCoupleSnapshot(req.user!.id) });
  },
);

couplesRouter.post('/couples/me/invitations', requireUser, requireCouple, verifyCsrf, async (req, res) => {
  res.status(201).json({ invitation: await service.createInvitation(req.couple!.id, req.user!.id) });
});

couplesRouter.get('/couples/me/invitations', requireUser, requireCouple, async (req, res) => {
  res.json({ invitation: await service.activeInvitation(req.couple!.id) });
});

couplesRouter.delete('/couples/me/invitations', requireUser, requireCouple, verifyCsrf, async (req, res) => {
  if (req.couple!.role !== 'owner') throw forbidden('Only the person who started the timeline can revoke the link');
  await service.revokeInvitations(req.couple!.id);
  res.status(204).end();
});

couplesRouter.get('/invitations/:code', requireUser, validate(codeSchema, 'params'), async (req, res) => {
  res.json({ invitation: await service.previewInvitation(valid<{ code: string }>(req, 'params').code) });
});

couplesRouter.post(
  '/invitations/:code/accept',
  requireUser,
  verifyCsrf,
  validate(codeSchema, 'params'),
  async (req, res) => {
    await service.acceptInvitation(valid<{ code: string }>(req, 'params').code, req.user!.id);
    res.json({ couple: await service.getCoupleSnapshot(req.user!.id) });
  },
);
