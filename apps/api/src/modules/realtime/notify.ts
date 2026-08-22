import type { Request } from 'express';
import { publish, type ChangeKind } from './bus.js';

/**
 * Which tab made this write. EventSource cannot send headers, so the stream identifies itself with
 * ?client=<id> and mutations echo the same id in X-Client-Id — the two have to agree for a tab to
 * recognise its own change coming back.
 */
const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function clientOf(req: Request): string | undefined {
  const value = req.get('x-client-id');
  return value && CLIENT_ID.test(value) ? value : undefined;
}

/**
 * Announce a change on the caller's couple. Reads couple, actor and origin off the request so a
 * route never assembles the payload by hand — and so the couple id keeps coming from the session.
 */
export async function notify(req: Request, kind: ChangeKind, id?: string): Promise<void> {
  const couple = req.couple?.id;
  if (!couple) return;
  await publish({ couple, kind, id, actor: req.user?.id, origin: clientOf(req) });
}
