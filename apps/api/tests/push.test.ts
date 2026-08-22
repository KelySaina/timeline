/**
 * Push notifications: the endpoints that store a subscription, and the scheduler that decides who
 * gets a reminder and when.
 *
 * Two things about how this file is written.
 *
 * VAPID keys are generated and put into the environment *before* the app is imported, which is why
 * every import here is dynamic. `config/env.ts` reads `process.env` once at module load, so a
 * static import would have already decided that push is unconfigured.
 *
 * The clock is never mocked. A reminder only fires during the recipient's local send hour, so
 * rather than pretending it is nine o'clock, the tests ask the database which timezone it *is*
 * nine o'clock in and put the user there. That exercises the real gating — including the
 * `at time zone` arithmetic the scheduler depends on — instead of a stub of it.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
process.env.VAPID_SUBJECT = 'mailto:test@timeline.local';

const { createApp } = await import('../src/app.js');
const { pool, query, queryOne } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { runReminderTick, SEND_HOUR } = await import('../src/modules/push/reminders.js');

let server: Server;
let base = '';

type Session = { cookies: Map<string, string> };
const newSession = (): Session => ({ cookies: new Map() });

async function call(
  session: Session,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const csrf = session.cookies.get('tl_csrf');
  if (csrf) headers['x-csrf-token'] = csrf;
  if (session.cookies.size) headers.cookie = [...session.cookies].map(([k, v]) => `${k}=${v}`).join('; ');

  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(';');
    const [name, value] = (pair ?? '').split('=');
    if (!name) continue;
    if (!value) session.cookies.delete(name);
    else session.cookies.set(name, value);
  }
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function signup(name: string, birthday?: string): Promise<{ session: Session; id: string }> {
  const session = newSession();
  const email = `${name}-${randomUUID()}@test.local`;
  const result = await call(session, 'POST', '/api/auth/signup', {
    email,
    password: 'a-long-enough-password',
    displayName: name,
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  if (birthday) {
    const patched = await call(session, 'PATCH', '/api/me', { birthday });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
  }
  return { session, id: result.body.user.id };
}

/** A subscription shaped like a browser's, pointing at an endpoint nothing will ever be sent to. */
const subscription = (tag = randomUUID()) => ({
  endpoint: `https://push.test.local/send/${tag}`,
  keys: { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: Buffer.alloc(16, 7).toString('base64url') },
});

/**
 * A timezone in which it is currently the send hour, straight from Postgres — the same expression
 * the scheduler uses, so the test cannot disagree with it about what hour it is.
 */
async function zoneAtSendHour(): Promise<{ name: string; localDate: string }> {
  const row = await queryOne<{ name: string; local_date: string }>(
    `select name, (now() at time zone name)::date::text as local_date
       from pg_timezone_names
      where extract(hour from now() at time zone name) = $1
        -- Abbreviations and legacy aliases exist alongside the real zones; a stable IANA name is
        -- what a browser would actually report.
        and name like '%/%'
      order by name
      limit 1`,
    [SEND_HOUR],
  );
  assert.ok(row, `no timezone is currently at hour ${SEND_HOUR}`);
  return { name: row.name, localDate: row.local_date };
}

/** A zone where it is definitely NOT the send hour, for the negative case. */
async function zoneAwayFromSendHour(): Promise<string> {
  const row = await queryOne<{ name: string }>(
    `select name from pg_timezone_names
      where extract(hour from now() at time zone name) not in ($1::int, $1::int - 1, $1::int + 1)
        and name like '%/%'
      order by name limit 1`,
    [SEND_HOUR],
  );
  assert.ok(row, 'no timezone away from the send hour');
  return row.name;
}

/** A date that is exactly `days` after `from`, as 'YYYY-MM-DD'. */
const plusDays = (from: string, days: number): string => {
  const [y, m, d] = from.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

before(async () => {
  await migrate();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

after(async () => {
  server?.close();
  await pool.end();
});

describe('push subscriptions', () => {
  it('reports state per browser, not per person', async () => {
    const { session } = await signup('Statey');
    const mine = subscription();
    const theirs = subscription();

    const before = await call(session, 'GET', `/api/push/state?endpoint=${encodeURIComponent(mine.endpoint)}`);
    assert.equal(before.status, 200);
    assert.equal(before.body.configured, true);
    assert.equal(before.body.publicKey, keys.publicKey);
    assert.equal(before.body.subscribed, false);
    assert.equal(before.body.devices, 0);
    assert.equal(before.body.sendHour, SEND_HOUR);

    assert.equal((await call(session, 'POST', '/api/push/subscribe', mine)).status, 201);

    // This browser is subscribed; a different one belonging to the same person is not. A per-user
    // boolean would light up the toggle on a laptop because a phone had said yes.
    const after1 = await call(session, 'GET', `/api/push/state?endpoint=${encodeURIComponent(mine.endpoint)}`);
    assert.equal(after1.body.subscribed, true);
    assert.equal(after1.body.devices, 1);
    const other = await call(session, 'GET', `/api/push/state?endpoint=${encodeURIComponent(theirs.endpoint)}`);
    assert.equal(other.body.subscribed, false);
    assert.equal(other.body.devices, 1, 'the device count is still per person');
  });

  it('upserts on the endpoint instead of collecting duplicates', async () => {
    const { session } = await signup('Upserter');
    const sub = subscription();

    await call(session, 'POST', '/api/push/subscribe', sub);
    await call(session, 'POST', '/api/push/subscribe', sub);
    const refreshed = await call(session, 'POST', '/api/push/subscribe', {
      ...sub,
      keys: { ...sub.keys, auth: Buffer.alloc(16, 9).toString('base64url') },
    });

    // Three subscribes, one device — otherwise every re-enable would double the sends.
    assert.equal(refreshed.body.devices, 1);
    const rows = await query<{ auth: string }>('select auth from push_subscriptions where endpoint = $1', [
      sub.endpoint,
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.auth, Buffer.alloc(16, 9).toString('base64url'), 'the newer keys win');
  });

  it('stores the timezone the browser reports, and refuses one Postgres does not know', async () => {
    const { session, id } = await signup('Zoney');
    const sub = subscription();

    const bogus = await call(session, 'POST', '/api/push/subscribe', { ...sub, timezone: 'Mars/Olympus' });
    assert.equal(bogus.status, 400);

    // And nothing was stored: a rejected timezone must not leave a subscription behind.
    assert.equal(
      (await query('select 1 from push_subscriptions where endpoint = $1', [sub.endpoint])).length,
      0,
    );

    assert.equal(
      (await call(session, 'POST', '/api/push/subscribe', { ...sub, timezone: 'Indian/Antananarivo' })).status,
      201,
    );
    const user = await queryOne<{ timezone: string }>('select timezone from users where id = $1', [id]);
    assert.equal(user?.timezone, 'Indian/Antananarivo');
  });

  it("lets a person unsubscribe their own browser and nobody else's", async () => {
    const owner = await signup('Owner');
    const stranger = await signup('Stranger');
    const sub = subscription();

    await call(owner.session, 'POST', '/api/push/subscribe', sub);

    // The endpoint is not a secret — it travels to a push service — so it must not be a capability.
    const attempt = await call(stranger.session, 'DELETE', '/api/push/subscribe', { endpoint: sub.endpoint });
    assert.equal(attempt.status, 200, 'deleting nothing is not an error');
    const still = await call(
      owner.session,
      'GET',
      `/api/push/state?endpoint=${encodeURIComponent(sub.endpoint)}`,
    );
    assert.equal(still.body.subscribed, true, "a stranger must not be able to silence someone else's phone");

    const gone = await call(owner.session, 'DELETE', '/api/push/subscribe', { endpoint: sub.endpoint });
    assert.equal(gone.body.subscribed, false);
    assert.equal(gone.body.devices, 0);
  });

  it('needs a session', async () => {
    const anonymous = await fetch(`${base}/api/push/state`);
    assert.equal(anonymous.status, 401);
  });
});

describe('reminder scheduler', () => {
  /** Collects what would have been sent, so selection can be asserted without a push service. */
  const recorder = () => {
    const sent: { userId: string; title: string; tag: string }[] = [];
    const deliver = async (userId: string, payload: { title: string; body: string; tag: string }) => {
      sent.push({ userId, title: payload.title, tag: payload.tag });
      return 1;
    };
    return { sent, deliver };
  };

  it('sends an anniversary reminder exactly remind_days_before days ahead, in local time', async () => {
    const zone = await zoneAtSendHour();
    const { session, id } = await signup('Anniversary');

    // Seven days out *in the user's own date*, which is the only reading of "seven days before"
    // that survives a couple in Antananarivo and a server in UTC.
    const startedOn = `2020-${plusDays(zone.localDate, 7).slice(5)}`;
    await call(session, 'POST', '/api/couples', { startedOn });
    await call(session, 'POST', '/api/push/subscribe', { ...subscription(), timezone: zone.name });

    const first = recorder();
    await runReminderTick(first.deliver);
    // Filtered to this user: the suite shares a database between runs, and asserting on the global
    // count would make an unrelated leftover row look like a bug here.
    const mine = first.sent.filter((s) => s.userId === id);
    assert.equal(mine.length, 1);
    // 2020 to the occurrence's year — counted from the date being reminded about, not from today.
    const years = Number(plusDays(zone.localDate, 7).slice(0, 4)) - 2020;
    assert.equal(mine[0]!.title, `Your ${years}th anniversary is in 7 days`);

    // The claim row is the whole concurrency story: a second tick in the same hour, or a second
    // replica, finds the send already taken.
    const second = recorder();
    await runReminderTick(second.deliver);
    assert.equal(second.sent.filter((s) => s.userId === id).length, 0);
  });

  it('stays quiet outside the send hour, and on the days either side', async () => {
    const away = await zoneAwayFromSendHour();
    const { session } = await signup('Elsewhere');
    const zone = await zoneAtSendHour();

    await call(session, 'POST', '/api/couples', { startedOn: `2020-${plusDays(zone.localDate, 7).slice(5)}` });
    await call(session, 'POST', '/api/push/subscribe', { ...subscription(), timezone: away });

    const wrongHour = recorder();
    await runReminderTick(wrongHour.deliver);
    assert.equal(
      wrongHour.sent.length,
      0,
      'a reminder arriving at 3am local is worse than no reminder',
    );

    // Same person, same date, now in a zone where it is the send hour but the date is not due.
    const { session: other } = await signup('WrongDay');
    await call(other, 'POST', '/api/couples', { startedOn: `2020-${plusDays(zone.localDate, 30).slice(5)}` });
    await call(other, 'POST', '/api/push/subscribe', { ...subscription(), timezone: zone.name });

    const wrongDay = recorder();
    await runReminderTick(wrongDay.deliver);
    assert.equal(wrongDay.sent.length, 0, '30 days out is not 7 days out');
  });

  it("reminds you about your partner's birthday and not your own", async () => {
    const zone = await zoneAtSendHour();
    const due = plusDays(zone.localDate, 7);

    const alex = await signup('Alex', `1994-${due.slice(5)}`);
    await call(alex.session, 'POST', '/api/couples', {});
    const invite = await call(alex.session, 'POST', '/api/couples/me/invitations', {});
    const code = invite.body.invitation.code;

    const mira = await signup('Mira');
    assert.equal((await call(mira.session, 'POST', `/api/invitations/${code}/accept`, {})).status, 200);

    await call(alex.session, 'POST', '/api/push/subscribe', { ...subscription(), timezone: zone.name });
    await call(mira.session, 'POST', '/api/push/subscribe', { ...subscription(), timezone: zone.name });

    const run = recorder();
    await runReminderTick(run.deliver);

    const forAlex = run.sent.filter((s) => s.userId === alex.id);
    const forMira = run.sent.filter((s) => s.userId === mira.id);
    assert.equal(forAlex.length, 0, "nobody needs a week's warning about their own birthday");
    assert.equal(forMira.length, 1);
    assert.equal(forMira[0]!.title, "Alex's birthday is in 7 days");
  });

  it('releases the claim when nothing accepted the notification', async () => {
    const zone = await zoneAtSendHour();
    const { session } = await signup('Undeliverable');
    await call(session, 'POST', '/api/couples', { startedOn: `2020-${plusDays(zone.localDate, 7).slice(5)}` });
    await call(session, 'POST', '/api/push/subscribe', { ...subscription(), timezone: zone.name });

    // Every device refused it — a push service having a bad minute. Holding the claim would mean
    // the reminder is silently lost for good, so it goes back.
    const failing = async () => 0;
    assert.equal(await runReminderTick(failing), 0);

    const retry = recorder();
    assert.equal(await runReminderTick(retry.deliver), 1, 'the next tick in the hour tries again');
    assert.equal(retry.sent.length, 1);
  });

  it('never reminds a person with no subscription', async () => {
    const zone = await zoneAtSendHour();
    const { session, id } = await signup('Unsubscribed');
    await call(session, 'POST', '/api/couples', { startedOn: `2020-${plusDays(zone.localDate, 7).slice(5)}` });
    await query('update users set timezone = $2 where id = $1', [id, zone.name]);

    const run = recorder();
    await runReminderTick(run.deliver);
    assert.equal(run.sent.filter((s) => s.userId === id).length, 0);
  });
});
