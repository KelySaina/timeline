import { Router } from 'express';
import { z } from 'zod';
import { requireCouple } from '../../middleware/coupleContext.js';
import { requireUser, verifyCsrf } from '../../middleware/session.js';
import { valid, validate } from '../../middleware/validate.js';
import { photoUpload } from '../photos/photos.service.js';
import * as service from './events.service.js';
import { EVENT_TYPES, MOODS } from './events.types.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date');
const eventType = z.enum(EVENT_TYPES);
const idParam = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  scope: z.enum(['past', 'upcoming', 'all']).default('past'),
  order: z.enum(['asc', 'desc']).default('desc'),
  // "type=trip,gift" — a comma list keeps the URL readable and shareable.
  type: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()) : undefined))
    .pipe(z.array(eventType).max(9).optional()),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const bodySchema = z.object({
  type: eventType,
  title: z.string().trim().min(1, 'Give it a title').max(140),
  description: z.string().trim().max(5000).nullish(),
  eventDate: isoDate,
  endDate: isoDate.nullish(),
  // No zod default here: .partial() below would re-apply it and quietly turn a
  // 'sometime in 2019' memory into an exact day on any unrelated PATCH. The column defaults instead.
  datePrecision: z.enum(['day', 'month', 'year']).optional(),
  location: z.string().trim().max(160).nullish(),
  mood: z.enum(MOODS).nullish(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
});

const patchSchema = bodySchema.partial().refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const withRange = <T extends { eventDate?: string; endDate?: string | null }>(value: T) =>
  !value.endDate || !value.eventDate || value.endDate >= value.eventDate;

export const eventsRouter = Router();
eventsRouter.use(requireUser, requireCouple);

eventsRouter.get('/events', validate(listQuery, 'query'), async (req, res) => {
  const q = valid<z.output<typeof listQuery>>(req, 'query');
  const result = await service.listEvents(req.couple!.id, {
    scope: q.scope,
    order: q.order,
    types: q.type,
    year: q.year,
    q: q.q,
    limit: q.limit,
    offset: q.offset,
  });
  res.json(result);
});

eventsRouter.get('/events/summary', async (req, res) => {
  res.json(await service.getSummary(req.couple!.id));
});

eventsRouter.post(
  '/events',
  verifyCsrf,
  validate(bodySchema.refine(withRange, { message: 'The end date comes before the start date', path: ['endDate'] })),
  async (req, res) => {
    res.status(201).json({ event: await service.createEvent(req.couple!.id, req.user!.id, req.body) });
  },
);

eventsRouter.get('/events/:id', validate(idParam, 'params'), async (req, res) => {
  res.json({ event: await service.getEvent(req.couple!.id, valid<{ id: string }>(req, 'params').id) });
});

eventsRouter.patch(
  '/events/:id',
  verifyCsrf,
  validate(idParam, 'params'),
  validate(patchSchema.refine(withRange, { message: 'The end date comes before the start date', path: ['endDate'] })),
  async (req, res) => {
    res.json({ event: await service.updateEvent(req.couple!.id, valid<{ id: string }>(req, 'params').id, req.body) });
  },
);

eventsRouter.delete('/events/:id', verifyCsrf, validate(idParam, 'params'), async (req, res) => {
  await service.softDeleteEvent(req.couple!.id, valid<{ id: string }>(req, 'params').id);
  res.status(204).end();
});

eventsRouter.post(
  '/events/:id/photos',
  verifyCsrf,
  validate(idParam, 'params'),
  photoUpload,
  async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    res.status(201).json({
      event: await service.addPhotos(req.couple!.id, req.user!.id, valid<{ id: string }>(req, 'params').id, files),
    });
  },
);

eventsRouter.delete(
  '/events/:id/photos/:photoId',
  verifyCsrf,
  validate(z.object({ id: z.string().uuid(), photoId: z.string().uuid() }), 'params'),
  async (req, res) => {
    res.json({ event: await service.removePhoto(req.couple!.id, valid<{ id: string }>(req, 'params').id, valid<{ photoId: string }>(req, 'params').photoId) });
  },
);

eventsRouter.put(
  '/events/:id/photos/order',
  verifyCsrf,
  validate(idParam, 'params'),
  validate(z.object({ order: z.array(z.string().uuid()).min(1).max(10) })),
  async (req, res) => {
    res.json({ event: await service.reorderPhotos(req.couple!.id, valid<{ id: string }>(req, 'params').id, req.body.order) });
  },
);

export const searchRouter = Router();
searchRouter.use(requireUser, requireCouple);

searchRouter.get(
  '/search',
  validate(
    z.object({
      q: z.string().trim().min(1, 'Type something to search for').max(120),
      limit: z.coerce.number().int().min(1).max(100).default(40),
      offset: z.coerce.number().int().min(0).default(0),
    }),
    'query',
  ),
  async (req, res) => {
    const q = valid<{ q: string; limit: number; offset: number }>(req, 'query');
    const result = await service.listEvents(req.couple!.id, {
      scope: 'all',
      order: 'desc',
      q: q.q,
      limit: q.limit,
      offset: q.offset,
    });
    res.json({ ...result, query: q.q });
  },
);
