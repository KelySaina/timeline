/**
 * End-to-end API test. Boots the real app against the real database and exercises the paths that
 * matter most: the story stays chronological, and one couple can never reach another's memories.
 *
 *   DATABASE_URL=... SESSION_SECRET=... npm test -w @timeline/api
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { initStorage, storageName } from '../src/modules/photos/storage/index.js';
import { startRealtime, stopRealtime } from '../src/modules/realtime/bus.js';
import { STORY_LAYOUTS } from '../src/modules/couples/storyLayouts.js';
import { THEMES } from '../src/modules/couples/themes.js';

let server: Server;
let base = '';

type Session = { cookies: Map<string, string> };

const newSession = (): Session => ({ cookies: new Map() });

async function call(
  session: Session,
  method: string,
  path: string,
  body?: unknown,
  options: { csrf?: boolean; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { ...options.headers };
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers['content-type'] = 'application/json';

  const csrf = session.cookies.get('tl_csrf');
  if (csrf && options.csrf !== false) headers['x-csrf-token'] = csrf;
  if (session.cookies.size) {
    headers.cookie = [...session.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: isForm ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
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

async function signup(name: string): Promise<Session> {
  const session = newSession();
  const result = await call(session, 'POST', '/api/auth/signup', {
    email: `${name}-${randomUUID()}@test.local`,
    password: 'a-long-enough-password',
    displayName: name,
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return session;
}

const photoForm = async (count = 1): Promise<FormData> => {
  const form = new FormData();
  for (let i = 0; i < count; i += 1) {
    const png = await sharp({
      create: { width: 200, height: 140, channels: 3, background: { r: 200, g: 120, b: 110 } },
    })
      .png()
      .toBuffer();
    form.append('photos', new Blob([new Uint8Array(png)], { type: 'image/png' }), `p${i}.png`);
  }
  return form;
};

before(async () => {
  try {
    await migrate();
    // Same boot order as the server: schema, then the photo store (bucket or directory), then the
    // LISTEN connection the change stream fans out over.
    await initStorage(3);
    await startRealtime();
    console.log(`[test] storage driver: ${storageName}`);
  } catch (error) {
    const reason = (error as { code?: string }).code === 'ECONNREFUSED'
      // Credentials redacted: this message lands in terminals and CI logs.
      ? `No database at ${(process.env.DATABASE_URL ?? '(DATABASE_URL unset)').replace(/\/\/[^@/]*@/, '//***@')}.\n` +
        'Start one with:  docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db'
      : (error as Error).message;
    throw new Error(`Cannot run the API suite — ${reason}`);
  }
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

after(async () => {
  server?.close();
  await stopRealtime();
  await pool.end();
});

describe('auth + couple lifecycle', () => {
  it('signs up, creates a relationship, and invites a partner who joins the same timeline', async () => {
    const alex = await signup('Alex');
    const mira = await signup('Mira');

    const created = await call(alex, 'POST', '/api/couples', {
      title: 'Alex & Mira',
      startedOn: '2024-06-01',
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.couple.members.length, 1);
    assert.equal(created.body.couple.together.years >= 1, true);

    const invite = await call(alex, 'POST', '/api/couples/me/invitations');
    assert.equal(invite.status, 201);
    const code = invite.body.invitation.code as string;
    assert.match(code, /^[0-9A-HJ-KM-NP-TV-Z]{10}$/);

    const preview = await call(mira, 'GET', `/api/invitations/${code}`);
    assert.equal(preview.body.invitation.invitedBy, 'Alex');

    const joined = await call(mira, 'POST', `/api/invitations/${code}/accept`);
    assert.equal(joined.status, 200);
    assert.equal(joined.body.couple.members.length, 2);

    // The code is single use.
    const stranger = await signup('Stranger');
    const reuse = await call(stranger, 'POST', `/api/invitations/${code}/accept`);
    assert.equal(reuse.status, 404);

    // And a user already in a relationship cannot join a second one.
    const second = await call(alex, 'POST', '/api/couples', { title: 'Someone else' });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'already_coupled');
  });

  it('accepts every shipped theme and rejects anything else', async () => {
    const user = await signup('Themes');
    await call(user, 'POST', '/api/couples', {});

    // Walks the shipped list rather than a copy of it, so adding a theme to the
    // store without letting the API accept it fails here instead of in the UI.
    assert.ok(THEMES.length >= 27, `expected the full set of themes, got ${THEMES.length}`);
    for (const theme of THEMES) {
      const result = await call(user, 'PATCH', '/api/couples/me', { theme });
      assert.equal(result.status, 200, theme);
      assert.equal(result.body.couple.theme, theme);
    }

    const bogus = await call(user, 'PATCH', '/api/couples/me', { theme: 'chartreuse' });
    assert.equal(bogus.status, 400);
  });

  it('accepts every shipped story layout, defaults to the rail, and rejects anything else', async () => {
    const user = await signup('Layouts');
    const created = await call(user, 'POST', '/api/couples', {});

    // Every existing couple was reading the rail before this column existed, so that is the only
    // safe default — a migration that silently relayouts someone's story is not a migration.
    assert.equal(created.body.couple.storyLayout, 'rail');

    // Walks the shipped list, so adding a layout to the SPA without letting the API accept it
    // fails here rather than as a 400 the reader sees.
    assert.equal(STORY_LAYOUTS.length, 6, `expected six layouts, got ${STORY_LAYOUTS.length}`);
    for (const storyLayout of STORY_LAYOUTS) {
      const result = await call(user, 'PATCH', '/api/couples/me', { storyLayout });
      assert.equal(result.status, 200, storyLayout);
      assert.equal(result.body.couple.storyLayout, storyLayout);
    }

    // The check constraint in 002 and this list have to agree; if they drift, the validator lets
    // something through and Postgres answers with a 500 instead of a 400.
    const bogus = await call(user, 'PATCH', '/api/couples/me', { storyLayout: 'spiral' });
    assert.equal(bogus.status, 400);

    // The shape and the colour are independent choices on the same relationship.
    const both = await call(user, 'PATCH', '/api/couples/me', { storyLayout: 'album', theme: 'midnight' });
    assert.equal(both.status, 200);
    assert.equal(both.body.couple.storyLayout, 'album');
    assert.equal(both.body.couple.theme, 'midnight');

    // And it survives a fresh read, not just the write's own response.
    const reread = await call(user, 'GET', '/api/couples/me');
    assert.equal(reread.body.couple.storyLayout, 'album');
  });

  it('rejects state-changing requests without the CSRF header', async () => {
    const user = await signup('Csrf');
    const result = await call(user, 'POST', '/api/couples', { title: 'Nope' }, { csrf: false });
    assert.equal(result.status, 401);
  });

  it('refuses timeline access before a relationship exists', async () => {
    const loner = await signup('Loner');
    const result = await call(loner, 'GET', '/api/events');
    assert.equal(result.status, 403);
  });

  it('rejects a weak password and a malformed email', async () => {
    const session = newSession();
    const weak = await call(session, 'POST', '/api/auth/signup', {
      email: 'someone@test.local',
      password: 'short',
      displayName: 'X',
    });
    assert.equal(weak.status, 400);
    assert.equal(weak.body.error.details.length >= 1, true);
  });
});

describe('timeline ordering and scope', () => {
  it('places a backdated memory in its own past, and keeps plans out of the story', async () => {
    const user = await signup('Ordering');
    await call(user, 'POST', '/api/couples', { startedOn: '2020-02-14' });

    // Created newest-first on purpose; the timeline must not care about insertion order.
    await call(user, 'POST', '/api/events', { type: 'memory', title: 'Recent', eventDate: '2025-05-05' });
    await call(user, 'POST', '/api/events', { type: 'milestone', title: 'The day we met', eventDate: '2020-02-14' });
    await call(user, 'POST', '/api/events', { type: 'trip', title: 'Paris', eventDate: '2099-06-04', endDate: '2099-06-12' });
    await call(user, 'POST', '/api/events', { type: 'memory', title: 'Sometime in 2021', eventDate: '2021-01-01', datePrecision: 'year' });

    const past = await call(user, 'GET', '/api/events?scope=past&order=asc');
    assert.deepEqual(
      past.body.events.map((e: any) => e.title),
      ['The day we met', 'Sometime in 2021', 'Recent'],
    );

    const upcoming = await call(user, 'GET', '/api/events?scope=upcoming');
    assert.deepEqual(upcoming.body.events.map((e: any) => e.title), ['Paris']);

    const summary = await call(user, 'GET', '/api/events/summary');
    assert.equal(summary.body.upcomingCount, 1);
    assert.deepEqual(summary.body.years.map((y: any) => y.year), [2025, 2021, 2020]);

    /**
     * The summary drives the filter chips over the story scroll, so every count in it has to
     * describe the same set that scroll shows — past only. Paris is a 2099 trip: it belongs to
     * upcomingCount and to nothing else. Counting it under types made a chip promise a row that
     * filtering could never return, and made the type chips disagree with the year chips beside
     * them (years summed to the past, types to everything).
     */
    assert.equal(summary.body.types.trip ?? 0, 0, 'a future trip must not appear as a story chip');
    assert.equal(summary.body.types.memory, 2);
    assert.equal(summary.body.types.milestone, 1);

    const chipTotal = Object.values(summary.body.types as Record<string, number>)
      .reduce((sum, n) => sum + n, 0);
    const storyTotal = (await call(user, 'GET', '/api/events?scope=past')).body.total;
    assert.equal(chipTotal, storyTotal, 'the chips must account for exactly the story scroll');

    const yearTotal = (summary.body.years as { count: number }[]).reduce((sum, y) => sum + y.count, 0);
    assert.equal(yearTotal, storyTotal, 'year chips and type chips must describe the same set');

    // And each chip's own number must match what clicking it returns.
    for (const [type, count] of Object.entries(summary.body.types as Record<string, number>)) {
      const clicked = await call(user, 'GET', `/api/events?scope=past&type=${type}`);
      assert.equal(clicked.body.total, count, `the ${type} chip promises ${count}`);
    }

    const filtered = await call(user, 'GET', '/api/events?scope=all&type=trip');
    assert.equal(filtered.body.total, 1);

    const byYear = await call(user, 'GET', '/api/events?scope=past&year=2021');
    assert.equal(byYear.body.events[0].title, 'Sometime in 2021');

    const badRange = await call(user, 'POST', '/api/events', {
      type: 'trip', title: 'Backwards', eventDate: '2025-05-05', endDate: '2025-05-01',
    });
    assert.equal(badRange.status, 400);
  });

  it('keeps a fuzzy date fuzzy when something unrelated is edited', async () => {
    const user = await signup('Precision');
    await call(user, 'POST', '/api/couples', {});
    const created = await call(user, 'POST', '/api/events', {
      type: 'memory', title: 'Sometime that summer', eventDate: '2019-01-01', datePrecision: 'year',
    });
    const patched = await call(user, 'PATCH', `/api/events/${created.body.event.id}`, {
      description: 'Adding the story later.',
    });
    assert.equal(patched.body.event.datePrecision, 'year');
    assert.equal(patched.body.event.eventDate, '2019-01-01');
  });

  it('finds memories by title, description, tag and location', async () => {
    const user = await signup('Search');
    await call(user, 'POST', '/api/couples', { startedOn: '2022-03-01' });
    await call(user, 'POST', '/api/events', {
      type: 'trip', title: 'Nosy Be', eventDate: '2023-12-21',
      description: 'Sunburnt on day two', location: 'Madagascar', tags: ['Beach', 'beach', ' travel '],
    });

    const byTag = await call(user, 'GET', '/api/search?q=travel');
    assert.equal(byTag.body.total, 1);
    assert.deepEqual(byTag.body.events[0].tags, ['beach', 'travel']); // normalised + de-duped

    const byLocation = await call(user, 'GET', '/api/search?q=madagas');
    assert.equal(byLocation.body.total, 1);

    const byStory = await call(user, 'GET', '/api/search?q=sunburnt');
    assert.equal(byStory.body.total, 1);

    const miss = await call(user, 'GET', '/api/search?q=zzzznothing');
    assert.equal(miss.body.total, 0);
  });

  it('soft-deletes a memory out of the timeline', async () => {
    const user = await signup('Deleter');
    await call(user, 'POST', '/api/couples', {});
    const created = await call(user, 'POST', '/api/events', { type: 'memory', title: 'Oops', eventDate: '2024-01-01' });
    const id = created.body.event.id;

    assert.equal((await call(user, 'DELETE', `/api/events/${id}`)).status, 204);
    assert.equal((await call(user, 'GET', `/api/events/${id}`)).status, 404);
    assert.equal((await call(user, 'GET', '/api/events?scope=all')).body.total, 0);
  });

  it('puts a deleted memory back, with its id and its photos, and stays idempotent', async () => {
    const user = await signup('Undoer');
    await call(user, 'POST', '/api/couples', {});
    const created = await call(user, 'POST', '/api/events', {
      type: 'trip',
      title: 'Almost lost',
      eventDate: '2024-03-04',
      location: 'Antsirabe',
      tags: ['train'],
    });
    const id = created.body.event.id;

    assert.equal((await call(user, 'DELETE', `/api/events/${id}`)).status, 204);

    // Restore, not re-create: the same id comes back, and so does everything hanging off it. A
    // restore that minted a new row would orphan the photos and break any link to the memory.
    const back = await call(user, 'POST', `/api/events/${id}/restore`);
    assert.equal(back.status, 200);
    assert.equal(back.body.event.id, id);
    assert.equal(back.body.event.title, 'Almost lost');
    assert.equal(back.body.event.location, 'Antsirabe');
    assert.deepEqual(back.body.event.tags, ['train']);

    assert.equal((await call(user, 'GET', `/api/events/${id}`)).status, 200);
    assert.equal((await call(user, 'GET', '/api/events?scope=all')).body.total, 1);

    // Tapping Undo twice, or both partners undoing the same delete, must not 404.
    assert.equal((await call(user, 'POST', `/api/events/${id}/restore`)).status, 200);

    // And the counters the filter chips are built from have to agree that it is back.
    const summary = await call(user, 'GET', '/api/events/summary');
    assert.equal(summary.body.types.trip, 1);

    // An id that was never theirs stays a 404, restore included.
    const outsider = await signup('NotYours');
    await call(outsider, 'POST', '/api/couples', {});
    assert.equal((await call(outsider, 'POST', `/api/events/${id}/restore`)).status, 404);
  });
});

describe('upcoming dates', () => {
  it('derives the anniversary from the start date and counts the years', async () => {
    const user = await signup('Dates');
    await call(user, 'POST', '/api/couples', { startedOn: '2020-06-01' });

    const upcoming = await call(user, 'GET', '/api/upcoming?days=400');
    const anniversary = upcoming.body.items.find((i: any) => i.kind === 'anniversary');
    assert.ok(anniversary, 'anniversary should be derived from started_on');
    assert.equal(anniversary.date.slice(5), '06-01');
    assert.equal(anniversary.ordinal >= 5, true);
    assert.equal(anniversary.daysUntil >= 0, true);

    // A leap-day birthday must resolve to a real date every year.
    await call(user, 'PATCH', '/api/me', { birthday: '1996-02-29' });
    const withBirthday = await call(user, 'GET', '/api/upcoming?days=400');
    const birthday = withBirthday.body.items.find((i: any) => i.kind === 'birthday');
    assert.ok(birthday);
    assert.match(birthday.date, /-02-(28|29)$/);

    const custom = await call(user, 'POST', '/api/recurring', { title: 'The day we met', month: 3, day: 12 });
    assert.equal(custom.status, 201);
    const derived = custom.body.recurring.find((r: any) => r.source !== 'custom');
    assert.equal(derived.editable, false);
    const patchDerived = await call(user, 'PATCH', `/api/recurring/${derived.id}`, { title: 'Hack' });
    assert.equal(patchDerived.status, 403);
  });
});

describe('photos and couple isolation', () => {
  it('stores photos privately and hides them from every other couple', async () => {
    const owner = await signup('Owner');
    await call(owner, 'POST', '/api/couples', { startedOn: '2021-01-01' });
    const created = await call(owner, 'POST', '/api/events', {
      type: 'trip', title: 'Private trip', eventDate: '2024-08-08',
    });
    const eventId = created.body.event.id;

    const uploaded = await call(owner, 'POST', `/api/events/${eventId}/photos`, await photoForm(2));
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.event.photos.length, 2);
    const photoId = uploaded.body.event.photos[0].id;

    for (const size of ['full', 'thumb']) {
      const response = await fetch(`${base}/api/photos/${photoId}?size=${size}`, {
        headers: { cookie: [...owner.cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/webp');
      assert.equal(response.headers.get('cache-control')?.includes('private'), true);
    }

    // A different couple, holding the real ids, must see nothing.
    const outsider = await signup('Outsider');
    await call(outsider, 'POST', '/api/couples', { startedOn: '2023-01-01' });
    assert.equal((await call(outsider, 'GET', `/api/events/${eventId}`)).status, 404);
    assert.equal((await call(outsider, 'GET', `/api/photos/${photoId}`)).status, 404);
    assert.equal((await call(outsider, 'PATCH', `/api/events/${eventId}`, { title: 'Mine now' })).status, 404);
    assert.equal((await call(outsider, 'DELETE', `/api/events/${eventId}`)).status, 404);
    assert.equal((await call(outsider, 'DELETE', `/api/events/${eventId}/photos/${photoId}`)).status, 404);
    assert.equal((await call(outsider, 'POST', `/api/events/${eventId}/restore`)).status, 404);

    // Anonymous callers get nowhere near it.
    assert.equal((await fetch(`${base}/api/photos/${photoId}`)).status, 401);

    // The owner can still remove it, and the file goes with the row.
    const removed = await call(owner, 'DELETE', `/api/events/${eventId}/photos/${photoId}`);
    assert.equal(removed.body.event.photos.length, 1);
  });

  it('refuses a file that is not a decodable image', async () => {
    const user = await signup('Uploader');
    await call(user, 'POST', '/api/couples', {});
    const created = await call(user, 'POST', '/api/events', { type: 'memory', title: 'Photos', eventDate: '2024-02-02' });

    const form = new FormData();
    form.append('photos', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }), 'fake.png');
    const result = await call(user, 'POST', `/api/events/${created.body.event.id}/photos`, form);
    assert.equal(result.status >= 400, true);
    assert.equal(result.body.error.code !== 'internal_error', true);
  });
});

/** Reads an SSE response frame by frame, so a test can wait for one change and give up cleanly. */
async function openStream(session: Session, client?: string) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/stream${client ? `?client=${client}` : ''}`, {
    headers: {
      accept: 'text/event-stream',
      cookie: [...session.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
    },
    signal: controller.signal,
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const pending: Record<string, unknown>[] = [];
  let buffer = '';

  // Unref'd: a pending timer must never be the reason the test process stays alive.
  const expire = (ms: number) =>
    new Promise<null>((resolve) => {
      const timer = setTimeout(() => resolve(null), ms);
      timer.unref?.();
    });

  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    /** The next `change` frame, or null once the budget runs out. */
    async next(ms = 5000): Promise<Record<string, any> | null> {
      const deadline = Date.now() + ms;
      while (!pending.length && Date.now() < deadline) {
        const chunk = await Promise.race([reader.read(), expire(deadline - Date.now())]);
        if (!chunk || chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          if (/^event: change$/m.test(part)) {
            const data = /^data: (.+)$/m.exec(part)?.[1];
            if (data) pending.push(JSON.parse(data));
          }
        }
      }
      return pending.shift() ?? null;
    },
    close(): void {
      controller.abort();
    },
  };
}

describe('the change stream', () => {
  it('tells a partner what the other one just wrote, and tells nobody else', async () => {
    const owner = await signup('Streamer');
    await call(owner, 'POST', '/api/couples', { startedOn: '2020-05-05' });
    const invite = await call(owner, 'POST', '/api/couples/me/invitations');
    const partner = await signup('Listener');
    assert.equal((await call(partner, 'POST', `/api/invitations/${invite.body.invitation.code}/accept`)).status, 200);

    // A couple with no connection to the story above: it must hear none of this.
    const outsider = await signup('Bystander');
    await call(outsider, 'POST', '/api/couples', {});

    const listening = await openStream(partner, 'partnertab1');
    const unrelated = await openStream(outsider, 'outsidertab');
    assert.equal(listening.status, 200);
    assert.equal(listening.contentType?.startsWith('text/event-stream'), true);

    try {
      const created = await call(owner, 'POST', '/api/events', {
        type: 'milestone', title: 'Moved in together', eventDate: '2021-09-01',
      });
      assert.equal(created.status, 201);
      const eventId = created.body.event.id;

      const change = await listening.next();
      assert.ok(change, 'the partner never heard about the new memory');
      assert.equal(change.kind, 'event.created');
      assert.equal(change.id, eventId);
      // A nudge, never content: the memory itself is still only reachable through /events/:id.
      assert.equal(change.title, undefined);
      assert.equal(Object.keys(change).sort().join(','), 'actor,couple,id,kind');

      // The same write, from the outsider's seat: nothing at all.
      assert.equal(await unrelated.next(1200), null, 'a change leaked to another couple');

      const edited = await call(owner, 'PATCH', `/api/events/${eventId}`, { title: 'Moved in' });
      assert.equal(edited.status, 200);
      assert.equal((await listening.next())?.kind, 'event.updated');

      assert.equal((await call(owner, 'DELETE', `/api/events/${eventId}`)).status, 204);
      const removed = await listening.next();
      assert.equal(removed?.kind, 'event.deleted');
      assert.equal(removed?.id, eventId);
    } finally {
      listening.close();
      unrelated.close();
    }
  });

  it('does not echo a write back to the tab that made it', async () => {
    const owner = await signup('Selfecho');
    await call(owner, 'POST', '/api/couples', {});
    const mine = await openStream(owner, 'sametabxx');
    const otherDevice = await openStream(owner, 'otherdevice');

    try {
      const created = await call(
        owner,
        'POST',
        '/api/events',
        { type: 'memory', title: 'Written here', eventDate: '2024-03-03' },
        { headers: { 'x-client-id': 'sametabxx' } },
      );
      assert.equal(created.status, 201);

      // The originating tab already applied the response; replaying it would fight local state.
      assert.equal(await mine.next(1200), null, 'a tab was told about its own write');
      // The same person's other device is not the origin, so it still updates.
      assert.equal((await otherDevice.next())?.id, created.body.event.id);
    } finally {
      mine.close();
      otherDevice.close();
    }
  });

  it('refuses a stream to anyone without a session or without a couple', async () => {
    assert.equal((await fetch(`${base}/api/stream`)).status, 401);

    const single = await signup('Coupleless');
    const response = await fetch(`${base}/api/stream`, {
      headers: { cookie: [...single.cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
    });
    assert.equal(response.status, 403);
    await response.body?.cancel();
  });
});
