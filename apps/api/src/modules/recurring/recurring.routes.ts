import { Router } from 'express';
import { z } from 'zod';
import { requireCouple } from '../../middleware/coupleContext.js';
import { requireUser, verifyCsrf } from '../../middleware/session.js';
import { valid, validate } from '../../middleware/validate.js';
import * as service from './recurring.service.js';

const idParam = z.object({ id: z.string().uuid() });

const recurringBody = z.object({
  title: z.string().trim().min(1, 'Give it a name').max(120),
  month: z.coerce.number().int().min(1).max(12),
  day: z.coerce.number().int().min(1).max(31),
  startYear: z.coerce.number().int().min(1900).max(2200).nullish(),
  remindDaysBefore: z.coerce.number().int().min(0).max(90).optional(),
});

export const upcomingRouter = Router();
upcomingRouter.use(requireUser, requireCouple);

upcomingRouter.get(
  '/upcoming',
  validate(z.object({ days: z.coerce.number().int().min(1).max(730).default(365) }), 'query'),
  async (req, res) => {
    const { days } = valid<{ days: number }>(req, 'query');
    res.json({ items: await service.listUpcoming(req.couple!.id, days) });
  },
);

upcomingRouter.get('/recurring', async (req, res) => {
  res.json({ recurring: await service.listRecurring(req.couple!.id) });
});

upcomingRouter.post('/recurring', verifyCsrf, validate(recurringBody), async (req, res) => {
  const id = await service.createRecurring(req.couple!.id, req.user!.id, req.body);
  res.status(201).json({ id, recurring: await service.listRecurring(req.couple!.id) });
});

upcomingRouter.patch(
  '/recurring/:id',
  verifyCsrf,
  validate(idParam, 'params'),
  validate(recurringBody.partial().refine((v) => Object.keys(v).length > 0, 'Nothing to update')),
  async (req, res) => {
    await service.updateRecurring(req.couple!.id, valid<{ id: string }>(req, 'params').id, req.body);
    res.json({ recurring: await service.listRecurring(req.couple!.id) });
  },
);

upcomingRouter.delete('/recurring/:id', verifyCsrf, validate(idParam, 'params'), async (req, res) => {
  await service.deleteRecurring(req.couple!.id, valid<{ id: string }>(req, 'params').id);
  res.status(204).end();
});
