/**
 * One endpoint, one file: everything this couple has, as a zip.
 *
 * A GET rather than a POST, because it is a read and because the browser has to be the one saving
 * it — a download this large cannot go through fetch() into memory. That means the session cookie
 * authenticates a plain navigation, which is exactly how photo bytes already work.
 */
import { Router } from 'express';
import { requireCouple } from '../../middleware/coupleContext.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requireUser } from '../../middleware/session.js';
import { buildExport } from './export.service.js';

export const exportRouter = Router();

exportRouter.get(
  '/export',
  requireUser,
  requireCouple,
  /*
   * Expensive in a way nothing else here is: it reads every row and streams every photo out of the
   * object store. Nobody legitimately needs more than a handful an hour, and this is the one
   * endpoint where a stuck retry loop could saturate the box.
   */
  rateLimit({ windowMs: 60 * 60 * 1000, max: 6, key: (req) => `export:${req.user?.id ?? req.ip}` }),
  async (req, res) => {
    const { stream, filename } = await buildExport(req.couple!.id);

    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    // No length to give — the archive is built as it is sent — so chunked, and never cached: this
    // is the couple's entire story in one response.
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');

    /*
     * If the reader closes the tab mid-download, stop reading from the object store. Without this
     * the archive keeps being built into a socket nobody is listening to, for as long as it takes.
     */
    res.on('close', () => {
      if (!res.writableEnded) stream.destroy();
    });

    stream.on('error', () => res.destroy());
    stream.pipe(res);
  },
);
