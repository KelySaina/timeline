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
import { exportRouter } from './modules/export/export.routes.js';
import { photosRouter } from './modules/photos/photos.routes.js';
import { projectsRouter } from './modules/projects/projects.routes.js';
import { pushRouter } from './modules/push/push.routes.js';
import { realtimeRouter } from './modules/realtime/realtime.routes.js';
import { upcomingRouter } from './modules/recurring/recurring.routes.js';

export function createApp() {
  const app = express();

  /*
   * Two hops, not one. Every deployment puts nginx (the web container) in front of this, and a
   * TLS edge in front of that — Caddy on the host, or Traefik on the docker network. nginx appends
   * its own peer to X-Forwarded-For, so the header the API receives ends "<client>, <edge>", and
   * `trust proxy: 1` resolved req.ip to that trailing edge address: one constant, identical for
   * every visitor. rateLimit() keys anonymous callers on req.ip, so the whole internet shared a
   * single bucket — the login and export limits counted everyone together.
   *
   * Counting from the app outwards, the real client sits at hop 2. A caller that prepends a value
   * of its own cannot move it: the invention lands further left and is never read. Reaching the
   * API directly (tests, `npm run dev`) sends no X-Forwarded-For at all, and req.ip falls back to
   * the socket address, as it did before.
   */
  app.set('trust proxy', 2);
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
  /*
   * Order matters here, and not only for path precedence. Several of these routers apply
   * `requireCouple` to their whole stack (eventsRouter, searchRouter, upcomingRouter), and a
   * pathless `router.use()` runs for every request that reaches it — including requests they will
   * never handle. So anything that must work *without* a relationship has to be mounted ahead of
   * them, or a signed-up user with no couple gets a 403 from a router they were only passing
   * through. Push is one of those: the browser asks whether notifications are possible before
   * there is anyone to be reminded about.
   */
  api.use(authRouter, couplesRouter, pushRouter);
  api.use(eventsRouter, searchRouter, upcomingRouter, photosRouter, projectsRouter, exportRouter, realtimeRouter);
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  if (!isProd) app.set('json spaces', 2);
  return app;
}
