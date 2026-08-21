import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { isProd } from '../config/env.js';
import { HttpError } from '../lib/errors.js';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
}

export function errorHandler(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) return next(error);

  if (error instanceof HttpError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }

  if (error instanceof multer.MulterError) {
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? 'That photo is larger than 8 MB'
        : error.code === 'LIMIT_FILE_COUNT'
          ? 'Up to 10 photos per memory'
          : 'That upload was rejected';
    res.status(413).json({ error: { code: 'upload_rejected', message } });
    return;
  }

  const pgError = error as { code?: string; constraint?: string };
  if (pgError?.code === '23505' || pgError?.code === '23P01') {
    res.status(409).json({ error: { code: 'conflict', message: 'That already exists' } });
    return;
  }

  console.error('[error]', error);
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Something went wrong on our side',
      ...(isProd ? {} : { detail: (error as Error)?.message }),
    },
  });
}
