import { EventEmitter } from 'node:events';
import pg from 'pg';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';

/**
 * The change bus behind /api/stream.
 *
 * Fan-out goes through Postgres `NOTIFY` rather than a module-level array of response objects,
 * because the API is meant to run as more than one replica: a memory written by the process that
 * holds partner A's connection has to reach the process holding partner B's. The database is
 * already the one thing every replica shares, so it carries the nudge too — no Redis, no cron.
 *
 * What travels is a *nudge, not content*: couple id, what kind of change, which row. Every client
 * then re-reads through the normal authorized endpoint. That keeps the couple check on the hot path
 * (the same reason photo bytes still stream through the API instead of a presigned URL) and keeps
 * the payload far below Postgres' 8000-byte NOTIFY limit.
 */

export const CHANNEL = 'timeline_change';

export type ChangeKind =
  | 'event.created'
  | 'event.updated'
  | 'event.deleted'
  | 'couple.updated'
  | 'member.joined'
  | 'recurring.changed';

export type Change = {
  /** Which couple the change belongs to. Every subscriber is filtered on this. */
  couple: string;
  kind: ChangeKind;
  /** The row that changed, when the kind has one. */
  id?: string;
  /** Who did it, so the other side can say "Mira added a memory". */
  actor?: string;
  /**
   * The tab that made the write, echoed from X-Client-Id. It skips its own change — it already
   * applied the response — while the same person's *other* devices still update.
   */
  origin?: string;
};

const local = new EventEmitter();
// Two people, a handful of tabs each. The ceiling only exists so a leak shows up as a warning.
local.setMaxListeners(64);

/** Publish a change to every replica. Never throws into a request: a missed nudge is not a failed write. */
export async function publish(change: Change): Promise<void> {
  try {
    await pool.query('select pg_notify($1, $2)', [CHANNEL, JSON.stringify(change)]);
  } catch (error) {
    console.error('[realtime] publish failed', error);
  }
}

/**
 * Streams have to be told to end on shutdown. server.close() waits for open connections, and an
 * SSE response never completes on its own — without this the container would hang until SIGKILL.
 */
export function onShutdown(fn: () => void): () => void {
  local.on('shutdown', fn);
  return () => local.off('shutdown', fn);
}

/** Ask every open stream on this replica to end. Call before server.close(). */
export function closeStreams(): void {
  local.emit('shutdown');
}

/** Subscribe to one couple's changes. Returns the unsubscribe function. */
export function subscribe(coupleId: string, listener: (change: Change) => void): () => void {
  const forCouple = (change: Change) => {
    if (change.couple === coupleId) listener(change);
  };
  local.on('change', forCouple);
  return () => local.off('change', forCouple);
}

/**
 * A LISTEN connection cannot come from the pool — it is held open for the life of the process and
 * would never be released back. It also has to survive the database restarting under it, so a
 * dropped connection reconnects with a backoff instead of taking the API down with it.
 */
let client: pg.Client | null = null;
let retry: NodeJS.Timeout | null = null;
let stopped = false;
let backoff = 1000;

async function connect(): Promise<void> {
  if (stopped) return;
  const next = new pg.Client({ connectionString: env.DATABASE_URL });

  next.on('notification', (message) => {
    if (message.channel !== CHANNEL || !message.payload) return;
    try {
      local.emit('change', JSON.parse(message.payload) as Change);
    } catch {
      console.error('[realtime] unparseable payload', message.payload);
    }
  });

  next.on('error', (error) => {
    console.error('[realtime] listener error', error);
    next.removeAllListeners();
    void next.end().catch(() => undefined);
    if (client === next) client = null;
    schedule();
  });

  await next.connect();
  await next.query(`listen ${CHANNEL}`);
  client = next;
  backoff = 1000;
  console.log('[realtime] listening on', CHANNEL);
}

function schedule(): void {
  if (stopped || retry) return;
  const delay = backoff;
  backoff = Math.min(backoff * 2, 30_000);
  retry = setTimeout(() => {
    retry = null;
    connect().catch((error) => {
      console.error('[realtime] reconnect failed', error);
      schedule();
    });
  }, delay);
}

export async function startRealtime(): Promise<void> {
  stopped = false;
  try {
    await connect();
  } catch (error) {
    // Boot must not hang on this: the API is fully usable without live updates.
    console.error('[realtime] initial listen failed, retrying in the background', error);
    schedule();
  }
}

export async function stopRealtime(): Promise<void> {
  stopped = true;
  if (retry) clearTimeout(retry);
  retry = null;
  local.removeAllListeners();
  const open = client;
  client = null;
  if (open) await open.end().catch(() => undefined);
}
