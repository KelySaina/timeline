import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import './types.js';
import { isProd } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { loadCouple } from './middleware/coupleContext.js';
import { loadSession } from './middleware/session.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { couplesRouter } from './modules/couples/couples.routes.js';
import { eventsRouter, searchRouter } from './modules/events/events.routes.js';
import { photosRouter } from './modules/photos/photos.routes.js';
import { upcomingRouter } from './modules/recurring/recurring.routes.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      // The SPA is served by nginx, which owns the page CSP; here we only harden the API responses.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  const api = express.Router();
  api.use(loadSession, loadCouple);
  api.use(authRouter, couplesRouter, eventsRouter, searchRouter, upcomingRouter, photosRouter);
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  if (!isProd) app.set('json spaces', 2);
  return app;
}
