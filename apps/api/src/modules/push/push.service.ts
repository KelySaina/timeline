/**
 * Web push: storing subscriptions and sending to them.
 *
 * Deliberately thin. A subscription is a disposable row keyed by the endpoint the push service
 * minted, and sending is a best-effort fan-out to every device a person has — there is no queue,
 * no retry schedule and no delivery guarantee, because none of those exist in web push either. A
 * notification that misses is a notification that misses; the app itself is still the truth.
 *
 * What this file does take seriously is not accumulating dead endpoints. A push service answering
 * 404 or 410 is telling us the subscription is gone for good, and keeping it would mean every
 * future send paying for a request that cannot succeed.
 */
import webpush, { type PushSubscription, type WebPushError } from 'web-push';
import { env, pushConfigured } from '../../config/env.js';
import { query, queryOne } from '../../db/pool.js';

export type SubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
};

/** What a notification carries. Read by the service worker, never by a person. */
export type PushPayload = {
  title: string;
  body: string;
  /** Where a tap should land. Same-origin path, e.g. '/upcoming'. */
  url: string;
  /**
   * Collapse key. A second notification with the same tag replaces the first rather than stacking,
   * which is what keeps a reminder from arriving twice on a device that was offline.
   */
  tag: string;
};

/**
 * Consecutive non-"gone" failures before a subscription is dropped. Generous on purpose: a device
 * that is merely off for a fortnight must survive, and at one send per reminder this is many weeks.
 */
const MAX_CONSECUTIVE_FAILURES = 12;

let configured = false;

function ready(): boolean {
  if (!pushConfigured) return false;
  if (!configured) {
    webpush.setVapidDetails(env.VAPID_SUBJECT!, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
    configured = true;
  }
  return true;
}

export const publicKey = (): string | null => (pushConfigured ? env.VAPID_PUBLIC_KEY! : null);

type Row = { id: string; endpoint: string; p256dh: string; auth: string };

/**
 * Store a subscription, or refresh the one this endpoint already has. Upsert rather than insert:
 * browsers hand back the same endpoint for the same installation, and a person who re-enables
 * notifications should end up with one row, not two sends.
 *
 * The endpoint is globally unique, so `on conflict` also silently moves a subscription between
 * accounts — which is correct on a shared device: whoever enabled it last is who it belongs to.
 */
export async function saveSubscription(userId: string, input: SubscriptionInput): Promise<void> {
  await query(
    `insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
          values ($1, $2, $3, $4, $5)
     on conflict (endpoint) do update
             set user_id = excluded.user_id,
                 p256dh = excluded.p256dh,
                 auth = excluded.auth,
                 user_agent = excluded.user_agent,
                 failures = 0`,
    [userId, input.endpoint, input.keys.p256dh, input.keys.auth, input.userAgent ?? null],
  );
}

/** Forget one device. Scoped to the user so an endpoint cannot be used to unsubscribe someone else. */
export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  await query('delete from push_subscriptions where user_id = $1 and endpoint = $2', [userId, endpoint]);
}

/* ---------------------------------------------------------------------------------------------
 * What someone wants to be told about
 * ------------------------------------------------------------------------------------------ */

export type NotificationPrefs = { reminders: boolean; activity: boolean; onThisDay: boolean };

const PREF_COLUMNS = {
  reminders: 'notify_reminders',
  activity: 'notify_activity',
  onThisDay: 'notify_on_this_day',
} as const;

export async function getPrefs(userId: string): Promise<NotificationPrefs> {
  const row = await queryOne<{ notify_reminders: boolean; notify_activity: boolean; notify_on_this_day: boolean }>(
    'select notify_reminders, notify_activity, notify_on_this_day from users where id = $1',
    [userId],
  );
  return {
    reminders: row?.notify_reminders ?? true,
    activity: row?.notify_activity ?? false,
    onThisDay: row?.notify_on_this_day ?? false,
  };
}

export async function setPrefs(userId: string, patch: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
  // Column names come from PREF_COLUMNS, never from the request — the keys are validated by Zod
  // before this is called, and nothing here interpolates a value.
  const sets: string[] = [];
  const params: unknown[] = [userId];
  for (const [key, column] of Object.entries(PREF_COLUMNS)) {
    const value = patch[key as keyof NotificationPrefs];
    if (value === undefined) continue;
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length) {
    await query(`update users set ${sets.join(', ')}, updated_at = now() where id = $1`, params);
  }
  return getPrefs(userId);
}

/* ---------------------------------------------------------------------------------------------
 * Claiming a send
 * ------------------------------------------------------------------------------------------ */

/**
 * Claim one notification before sending it, and say whether this replica won.
 *
 * This is the whole concurrency story for every kind of send. Each replica receives every change
 * and runs every tick, so the insert is what decides who delivers: the primary key lets exactly one
 * of them through and the rest get nothing. It is also what makes a redeploy mid-tick safe.
 *
 * The key has to name the *occasion*, not the row — 'recurring:<id>:<date>' rather than
 * 'recurring:<id>' — or the second occurrence is silently never sent.
 */
export async function claim(userId: string, key: string): Promise<boolean> {
  const won = await query<{ user_id: string }>(
    'insert into notification_sends (user_id, key) values ($1, $2) on conflict do nothing returning user_id',
    [userId, key],
  );
  return won.length > 0;
}

/** Give a claim back, so a later attempt can retry something nothing accepted. */
export async function releaseClaim(userId: string, key: string): Promise<void> {
  await query('delete from notification_sends where user_id = $1 and key = $2', [userId, key]);
}

export async function countSubscriptions(userId: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    'select count(*) as count from push_subscriptions where user_id = $1',
    [userId],
  );
  return Number(row?.count ?? 0);
}

/** True when this exact browser is already subscribed — what the toggle in the UI reflects. */
export async function hasSubscription(userId: string, endpoint: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    'select id from push_subscriptions where user_id = $1 and endpoint = $2',
    [userId, endpoint],
  );
  return Boolean(row);
}

/**
 * Send to every device a person has. Returns how many actually accepted it.
 *
 * Never throws: a reminder failing to reach a phone must not fail the tick that produced it, let
 * alone the request that triggered a test send.
 */
export async function sendToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!ready()) return 0;

  const rows = await query<Row>(
    'select id, endpoint, p256dh, auth from push_subscriptions where user_id = $1',
    [userId],
  );
  if (rows.length === 0) return 0;

  const body = JSON.stringify(payload);
  let delivered = 0;

  await Promise.all(
    rows.map(async (row) => {
      const subscription: PushSubscription = {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      };
      try {
        // TTL matches the collapse behaviour: a reminder that could not be delivered within a day
        // has stopped being a reminder.
        await webpush.sendNotification(subscription, body, { TTL: 86_400 });
        delivered += 1;
        await query('update push_subscriptions set last_sent_at = now(), failures = 0 where id = $1', [row.id]);
      } catch (error) {
        const status = (error as WebPushError)?.statusCode;
        if (status === 404 || status === 410) {
          // Gone for good — the browser was uninstalled, or the push service rotated the endpoint.
          await query('delete from push_subscriptions where id = $1', [row.id]);
          return;
        }
        /*
         * Anything that is not an outright "gone" is treated as transient — a push service having a
         * bad minute, a network blip — but not forever. A subscription that has failed this many
         * times in a row without ever succeeding is not coming back, and keeping it means every
         * future send pays for a request that cannot land.
         */
        const after = await queryOne<{ failures: number }>(
          'update push_subscriptions set failures = failures + 1 where id = $1 returning failures',
          [row.id],
        );
        if ((after?.failures ?? 0) >= MAX_CONSECUTIVE_FAILURES) {
          await query('delete from push_subscriptions where id = $1', [row.id]);
          console.warn('[push] dropped a subscription after repeated failures', { subscription: row.id });
          return;
        }
        console.warn('[push] send failed', { subscription: row.id, status, failures: after?.failures });
      }
    }),
  );

  return delivered;
}
