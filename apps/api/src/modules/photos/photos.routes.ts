import { Router } from 'express';
import { z } from 'zod';
import { queryOne } from '../../db/pool.js';
import { notFound } from '../../lib/errors.js';
import { requireCouple } from '../../middleware/coupleContext.js';
import { requireUser } from '../../middleware/session.js';
import { valid, validate } from '../../middleware/validate.js';
import { ObjectNotFound, readObject } from './storage/index.js';

export const photosRouter = Router();

const params = z.object({ id: z.string().uuid() });
const querySchema = z.object({ size: z.enum(['full', 'thumb']).default('full') });

/**
 * Photos are private files streamed through the API, never public URLs.
 * The couple filter comes from the session, so a guessed photo id gets a 404.
 */
photosRouter.get(
  '/photos/:id',
  requireUser,
  requireCouple,
  validate(params, 'params'),
  validate(querySchema, 'query'),
  async (req, res) => {
    const row = await queryOne<{ storage_key: string; thumb_key: string }>(
      'select storage_key, thumb_key from event_photos where id = $1 and couple_id = $2',
      [valid<{ id: string }>(req, 'params').id, req.couple!.id],
    );
    if (!row) throw notFound('That photo is not in your timeline');

    const key = valid<{ size: 'full' | 'thumb' }>(req, 'query').size === 'thumb' ? row.thumb_key : row.storage_key;
    const object = await readObject(key).catch((error: unknown) => {
      if (error instanceof ObjectNotFound) throw notFound('That photo is missing');
      throw error;
    });

    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'private, max-age=86400, immutable');
    res.set('Cross-Origin-Resource-Policy', 'same-origin');
    if (object.contentLength) res.set('Content-Length', String(object.contentLength));

    // A failure mid-stream must end the response, not leave the client hanging on a truncated body.
    object.stream.on('error', () => res.destroy());
    object.stream.pipe(res);
  },
);
