import { Router } from 'express';
import { queryOne } from '../../db/pool.js';
import { requireCouple } from '../../middleware/coupleContext.js';
import { requireUser } from '../../middleware/session.js';
import { onShutdown, subscribe, type Change } from './bus.js';

/**
 * Server-sent events, not a WebSocket. The traffic is one-directional (the server tells the client
 * something moved; the client writes over the normal REST endpoints), it rides the session cookie
 * that already exists, it needs no protocol upgrade through nginx and Traefik, and the browser
 * reconnects on its own. A WebSocket would buy nothing here and cost all of that.
 */
export const realtimeRouter = Router();

const HEARTBEAT_MS = 25_000;

realtimeRouter.get('/stream', requireUser, requireCouple, async (req, res) => {
  const coupleId = req.couple!.id;
  const origin = typeof req.query.client === 'string' ? req.query.client : undefined;

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    // nginx buffers proxied responses by default, which would hold every event until the buffer
    // fills. This turns that off for the stream without touching the config for the rest of /api.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // Tells the browser how long to wait before reconnecting after a drop.
  res.write('retry: 3000\n\n');

  const send = (change: Change): void => {
    // The tab that made the write already applied the server's response; replaying it would fight
    // the local state. Other tabs of the same person are not the origin, so they still update.
    if (origin && change.origin === origin) return;
    res.write(`event: change\ndata: ${JSON.stringify(change)}\n\n`);
  };

  const unsubscribe = subscribe(coupleId, send);

  /**
   * A stream outlives the request that opened it, so `token_version` is re-checked on every beat:
   * signing out everywhere has to close the pipe too, not just refuse the next fetch.
   */
  const heartbeat = setInterval(async () => {
    try {
      const row = await queryOne<{ token_version: number }>(
        'select token_version from users where id = $1',
        [req.user!.id],
      );
      if (!row || row.token_version !== req.user!.tokenVersion) {
        res.write('event: revoked\ndata: {}\n\n');
        return close();
      }
      res.write(': beat\n\n');
    } catch (error) {
      console.error('[realtime] heartbeat failed', error);
    }
  }, HEARTBEAT_MS);

  function close(): void {
    clearInterval(heartbeat);
    unsubscribe();
    releaseShutdown();
    res.end();
  }

  const releaseShutdown = onShutdown(close);

  req.on('close', close);
  res.on('error', close);
});
