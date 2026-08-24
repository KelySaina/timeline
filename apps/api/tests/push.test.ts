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
const { ensureDatabase } = await import('./support/database.js');
const { runReminderTick, runPlanReminderTick, runOnThisDayTick, SEND_HOUR } =
  await import('../src/modules/push/reminders.js');
const { handleChangeForTests } = await import('../src/modules/push/activity.js');

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
  await ensureDatabase();
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

  it('lists the devices notifications go to, and lets any of them switch another off', async () => {
    const { session } = await signup('Traveller');
    const phone = { ...subscription(), userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1' };
    const laptop = { ...subscription(), userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' };
    await call(session, 'POST', '/api/push/subscribe', phone);
    await call(session, 'POST', '/api/push/subscribe', laptop);

    // Asked from the laptop, so it is the one marked "this one".
    const listed = await call(session, 'GET', `/api/push/devices?endpoint=${encodeURIComponent(laptop.endpoint)}`);
    assert.equal(listed.status, 200);
    const devices = listed.body.devices as { id: string; label: string; current: boolean }[];
    assert.equal(devices.length, 2);
    assert.deepEqual(devices.map((d) => d.label).sort(), ['Linux · Chrome', 'iPhone · Safari']);
    assert.deepEqual(
      devices.filter((d) => d.current).map((d) => d.label),
      ['Linux · Chrome'],
      'only the browser doing the asking is the current one',
    );

    // The endpoint never travels back out: it is the address sends are accepted at, and the id is
    // enough to name a row.
    assert.equal(JSON.stringify(devices).includes('push.test.local'), false);

    // The whole point: switching off a phone you are not holding.
    const phoneId = devices.find((d) => d.label === 'iPhone · Safari')!.id;
    const removed = await call(session, 'DELETE', `/api/push/devices/${phoneId}`);
    assert.equal(removed.status, 200);
    assert.deepEqual((removed.body.devices as { label: string }[]).map((d) => d.label), ['Linux · Chrome']);
    // And it really is gone, not merely absent from that one response.
    const laptopState = await call(session, 'GET', `/api/push/state?endpoint=${encodeURIComponent(phone.endpoint)}`);
    assert.equal(laptopState.body.subscribed, false);
    assert.equal(laptopState.body.devices, 1);
  });

  it('cannot switch off a device belonging to someone else', async () => {
    const owner = await signup('DeviceOwner');
    const stranger = await signup('DeviceStranger');
    await call(owner.session, 'POST', '/api/push/subscribe', subscription());
    const mine = (await call(owner.session, 'GET', '/api/push/devices')).body.devices[0];

    // An id is not a capability. A stranger holding a real one removes nothing, and is told so
    // rather than being allowed to believe it worked.
    const attempt = await call(stranger.session, 'DELETE', `/api/push/devices/${mine.id}`);
    assert.equal(attempt.status, 404);
    assert.equal((await call(owner.session, 'GET', '/api/push/devices')).body.devices.length, 1);

    // A well-formed id that exists nowhere is the same answer.
    assert.equal(
      (await call(owner.session, 'DELETE', `/api/push/devices/${randomUUID()}`)).status,
      404,
    );
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

  it('stays quiet for someone who turned reminders off', async () => {
    const zone = await zoneAtSendHour();
    const { session, id } = await signup('OptedOut');
    await call(session, 'POST', '/api/couples', { startedOn: `2020-${plusDays(zone.localDate, 7).slice(5)}` });
    await call(session, 'POST', '/api/push/subscribe', { ...subscription(), timezone: zone.name });

    // Having a subscription used to mean wanting reminders. It no longer does — the frequent kinds
    // arrived and an implicit yes would have covered them too.
    const off = await call(session, 'PATCH', '/api/push/prefs', { reminders: false });
    assert.equal(off.status, 200);
    assert.equal(off.body.prefs.reminders, false);

    const run = recorder();
    await runReminderTick(run.deliver);
    assert.equal(run.sent.filter((s) => s.userId === id).length, 0);
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

describe('plan reminders', () => {
  const recorder = () => {
    const sent: { userId: string; title: string; url: string }[] = [];
    const deliver = async (userId: string, payload: { title: string; body: string; url: string; tag: string }) => {
      sent.push({ userId, title: payload.title, url: payload.url });
      return 1;
    };
    return { sent, deliver };
  };

  it('warns about a one-off plan its own number of days ahead', async () => {
    const zone = await zoneAtSendHour();
    const { session, id } = await signup('Planner');
    await call(session, 'POST', '/api/couples', {});
    await call(session, 'POST', '/api/push/subscribe', { ...subscription(), timezone: zone.name });

    // Three days out with three days of warning, and the same plan with none.
    const due = await call(session, 'POST', '/api/events', {
      type: 'celebration', title: 'Anniversary dinner', eventDate: plusDays(zone.localDate, 3), remindDaysBefore: 3,
    });
    assert.equal(due.status, 201);
    assert.equal(due.body.event.remindDaysBefore, 3, 'the lead time comes back on the event');

    const silent = await call(session, 'POST', '/api/events', {
      type: 'trip', title: 'Unannounced trip', eventDate: plusDays(zone.localDate, 3),
    });
    assert.equal(silent.body.event.remindDaysBefore, null, 'no reminder unless one was asked for');

    // Right number of days, wrong lead time: 10 days out with 3 days of warning says nothing today.
    await call(session, 'POST', '/api/events', {
      type: 'trip', title: 'Later trip', eventDate: plusDays(zone.localDate, 10), remindDaysBefore: 3,
    });

    const run = recorder();
    await runPlanReminderTick(run.deliver);
    const mine = run.sent.filter((s) => s.userId === id);
    assert.deepEqual(mine.map((s) => s.title), ['Anniversary dinner is in 3 days']);
    assert.equal(mine[0]!.url, `/memory/${due.body.event.id}`, 'a tap goes to the plan itself');

    // Claimed for that occurrence, so the other ticks in the hour add nothing.
    const again = recorder();
    await runPlanReminderTick(again.deliver);
    assert.equal(again.sent.filter((s) => s.userId === id).length, 0);
  });

  it('says nothing about a plan that has passed, or one that was deleted', async () => {
    const zone = await zoneAtSendHour();
    const { session, id } = await signup('Hindsight');
    await call(session, 'POST', '/api/couples', {});
    await call(session, 'POST', '/api/push/subscribe', { ...subscription(), timezone: zone.name });

    // A lead time on a past date is accepted and never fires — refusing it would mean a memory whose
    // date is corrected backwards needs its reminder cleared by hand.
    const past = await call(session, 'POST', '/api/events', {
      type: 'memory', title: 'Already happened', eventDate: plusDays(zone.localDate, -3), remindDaysBefore: 3,
    });
    assert.equal(past.status, 201);

    // Due today, then deleted: a soft-deleted plan is not a plan.
    const removed = await call(session, 'POST', '/api/events', {
      type: 'trip', title: 'Called off', eventDate: plusDays(zone.localDate, 2), remindDaysBefore: 2,
    });
    assert.equal((await call(session, 'DELETE', `/api/events/${removed.body.event.id}`)).status, 204);

    const run = recorder();
    await runPlanReminderTick(run.deliver);
    assert.deepEqual(run.sent.filter((s) => s.userId === id), []);
  });

  it('is governed by the same switch as the yearly dates', async () => {
    const zone = await zoneAtSendHour();
    const { session, id } = await signup('Muted');
    await call(session, 'POST', '/api/couples', {});
    await call(session, 'POST', '/api/push/subscribe', { ...subscription(), timezone: zone.name });
    await call(session, 'POST', '/api/events', {
      type: 'trip', title: 'Quietly', eventDate: plusDays(zone.localDate, 5), remindDaysBefore: 5,
    });
    assert.equal((await call(session, 'PATCH', '/api/push/prefs', { reminders: false })).status, 200);

    const run = recorder();
    await runPlanReminderTick(run.deliver);
    assert.equal(run.sent.filter((s) => s.userId === id).length, 0);
  });

  it('can be cleared again', async () => {
    const zone = await zoneAtSendHour();
    const { session, id } = await signup('Recanted');
    await call(session, 'POST', '/api/couples', {});
    await call(session, 'POST', '/api/push/subscribe', { ...subscription(), timezone: zone.name });
    const plan = await call(session, 'POST', '/api/events', {
      type: 'trip', title: 'Never mind', eventDate: plusDays(zone.localDate, 4), remindDaysBefore: 4,
    });

    // Explicit null, not an omitted field: the patch has to be able to say "no reminder" as well as
    // "leave it alone".
    const cleared = await call(session, 'PATCH', `/api/events/${plan.body.event.id}`, { remindDaysBefore: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.event.remindDaysBefore, null);

    const run = recorder();
    await runPlanReminderTick(run.deliver);
    assert.equal(run.sent.filter((s) => s.userId === id).length, 0);
  });
});

describe('on this day', () => {
  const recorder = () => {
    const sent: { userId: string; title: string; tag: string }[] = [];
    const deliver = async (userId: string, payload: { title: string; body: string; tag: string }) => {
      sent.push({ userId, title: payload.title, tag: payload.tag });
      return 1;
    };
    return { sent, deliver };
  };

  it('looks back at the same date in past years, once a day', async () => {
    const zone = await zoneAtSendHour();
    const { session, id } = await signup('Nostalgic');
    await call(session, 'POST', '/api/couples', {});
    await call(session, 'POST', '/api/push/subscribe', { ...subscription(), timezone: zone.name });
    assert.equal((await call(session, 'PATCH', '/api/push/prefs', { onThisDay: true })).status, 200);

    // Today's month and day, three years back — and one a year later, so the count matters.
    const [year, month, day] = zone.localDate.split('-').map(Number);
    await call(session, 'POST', '/api/events', {
      type: 'memory', title: 'The long walk', eventDate: `${year - 3}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    });
    await call(session, 'POST', '/api/events', {
      type: 'memory', title: 'The short walk', eventDate: `${year - 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    });
    // A different date entirely, which must not be swept in.
    await call(session, 'POST', '/api/events', {
      type: 'memory', title: 'Some other day', eventDate: `${year - 2}-01-02`,
    });

    const first = recorder();
    await runOnThisDayTick(first.deliver);
    const mine = first.sent.filter((s) => s.userId === id);
    assert.equal(mine.length, 1, 'one notification for the day, however many memories it holds');
    // Led by the oldest, because that is the number worth hearing.
    assert.equal(mine[0]!.title, '3 years ago today, and 1 more');
    assert.equal(mine[0]!.tag, `onthisday:${zone.localDate}`);

    // Claimed for the day, so the other three ticks in the hour say nothing.
    const second = recorder();
    await runOnThisDayTick(second.deliver);
    assert.equal(second.sent.filter((s) => s.userId === id).length, 0);
  });

  it('says nothing on a day that holds no memory, and skips fuzzy dates', async () => {
    const zone = await zoneAtSendHour();
    const { session, id } = await signup('Quiet');
    await call(session, 'POST', '/api/couples', {});
    await call(session, 'POST', '/api/push/subscribe', { ...subscription(), timezone: zone.name });
    await call(session, 'PATCH', '/api/push/prefs', { onThisDay: true });

    const [year, month, day] = zone.localDate.split('-').map(Number);
    // "Sometime that year" did not happen on a day, so it has no anniversary to mark. Marking one
    // would be inventing precision the schema deliberately refuses to.
    await call(session, 'POST', '/api/events', {
      type: 'memory',
      title: 'Sometime that summer',
      eventDate: `${year - 4}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      datePrecision: 'year',
    });

    const run = recorder();
    await runOnThisDayTick(run.deliver);
    assert.equal(run.sent.filter((s) => s.userId === id).length, 0);
  });
});

describe('activity notifications', () => {
  /*
   * Memories are inserted straight into the table rather than posted through the API, and the
   * Change is built by hand — which is what these tests want anyway, since they exercise the
   * handler and not the bus.
   *
   * It is also what makes them deterministic. Posting publishes a change, and anything else
   * listening on this database — a dev API container on a developer's machine, another replica —
   * has its own activity handler that will claim the notification first. That is the design working
   * (the claim row is what stops two replicas both sending) but it makes a test that asserts "this
   * process sent it" a race against whatever else is running.
   */
  const insertEvent = async (coupleId: string, userId: string, title: string): Promise<string> => {
    const row = await queryOne<{ id: string }>(
      `insert into events (couple_id, created_by, type, title, event_date)
            values ($1, $2, 'memory', $3, '2024-05-05') returning id`,
      [coupleId, userId, title],
    );
    return row!.id;
  };

  /*
   * Asserting on deliveries rather than on the claim table. A claim is released again when nothing
   * accepts the notification, and these endpoints accept nothing — so the table looks identical
   * whether a send was skipped on purpose or merely failed.
   */
  const recorder = () => {
    const sent: { userId: string; title: string; body: string; url: string }[] = [];
    const deliver = async (
      userId: string,
      payload: { title: string; body: string; url: string; tag: string },
    ) => {
      sent.push({ userId, title: payload.title, body: payload.body, url: payload.url });
      return 1;
    };
    return { sent, deliver };
  };

  it('tells the other partner, never the one who wrote it, and only when asked', async () => {
    const alex = await signup('Alex');
    await call(alex.session, 'POST', '/api/couples', {});
    const invite = await call(alex.session, 'POST', '/api/couples/me/invitations', {});
    const mira = await signup('Mira');
    await call(mira.session, 'POST', `/api/invitations/${invite.body.invitation.code}/accept`, {});

    await call(alex.session, 'POST', '/api/push/subscribe', subscription());
    await call(mira.session, 'POST', '/api/push/subscribe', subscription());

    const couple = (await call(alex.session, 'GET', '/api/couples/me')).body.couple.id;
    const eventId = await insertEvent(couple, alex.id, 'Nosy Be');
    const change = { couple, kind: 'event.created' as const, id: eventId, actor: alex.id };

    // Nobody has opted in, so nobody hears about it. This is the frequent kind, and the frequent
    // kind is what makes someone revoke permission for the other two.
    const silent = recorder();
    await handleChangeForTests(change, silent.deliver);
    assert.equal(silent.sent.length, 0, 'off by default');

    assert.equal((await call(mira.session, 'PATCH', '/api/push/prefs', { activity: true })).status, 200);
    const told = recorder();
    await handleChangeForTests(change, told.deliver);
    assert.equal(told.sent.length, 1);
    assert.equal(told.sent[0]!.userId, mira.id, 'the partner, not the author');
    assert.equal(told.sent[0]!.title, 'Alex added a memory');
    assert.equal(told.sent[0]!.body, 'Nosy Be', 'naming it is the whole point of interrupting someone');
    assert.equal(told.sent[0]!.url, `/memory/${eventId}`, 'straight to the memory, not the timeline');

    // The same memory must not interrupt anyone twice, however many times the change is seen —
    // which is what makes it safe for every replica to hear every change. Opting Alex in as well
    // changes nothing here: this memory has already been announced.
    assert.equal((await call(alex.session, 'PATCH', '/api/push/prefs', { activity: true })).status, 200);
    const again = recorder();
    await handleChangeForTests(change, again.deliver);
    assert.deepEqual(again.sent, [], 'already announced, and never to the author');

    // A different memory from Alex still reaches Mira, so the silence above is about that one
    // memory having been announced and not about Alex being the author of everything.
    const secondId = await insertEvent(couple, alex.id, 'The long way home');
    const next = recorder();
    await handleChangeForTests(
      { couple, kind: 'event.created', id: secondId, actor: alex.id },
      next.deliver,
    );
    assert.deepEqual(next.sent.map((s) => s.userId), [mira.id]);
    assert.equal(next.sent[0]!.body, 'The long way home');
  });

  it('ignores the changes that are housekeeping rather than news', async () => {
    const alex = await signup('Editor');
    await call(alex.session, 'POST', '/api/couples', {});
    const invite = await call(alex.session, 'POST', '/api/couples/me/invitations', {});
    const mira = await signup('Reader');
    await call(mira.session, 'POST', `/api/invitations/${invite.body.invitation.code}/accept`, {});
    await call(mira.session, 'POST', '/api/push/subscribe', subscription());
    await call(mira.session, 'PATCH', '/api/push/prefs', { activity: true });

    const couple = (await call(alex.session, 'GET', '/api/couples/me')).body.couple.id;
    const eventId = await insertEvent(couple, alex.id, 'Edited later');

    // An edit, a delete and a theme change are all things the other screen has already applied in
    // silence. Interrupting someone for them is how notifications get switched off.
    const run = recorder();
    for (const kind of ['event.updated', 'event.deleted', 'couple.updated', 'recurring.changed'] as const) {
      await handleChangeForTests({ couple, kind, id: eventId, actor: alex.id }, run.deliver);
    }
    assert.deepEqual(run.sent, []);

    // A new memory on the same couple still gets through, so the silence above is about the kind of
    // change and not about anything else in this setup.
    const freshId = await insertEvent(couple, alex.id, 'Worth saying');
    const news = recorder();
    await handleChangeForTests(
      { couple, kind: 'event.created', id: freshId, actor: alex.id },
      news.deliver,
    );
    assert.deepEqual(news.sent.map((s) => s.title), ['Editor added a memory']);
  });
});
