/**
 * The export, read back.
 *
 * The archive is opened and its entries parsed rather than checked by size or status code, because
 * the promise this feature makes is specifically that the file *works* somewhere else. A 200 with a
 * corrupt zip, or a readable page whose images all point at the wrong path, would satisfy every
 * cheaper assertion — and the second of those was a real bug caught this way.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import sharp from 'sharp';
import { fromBuffer, type Entry, type ZipFile } from 'yauzl';
import { createApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { initStorage } from '../src/modules/photos/storage/index.js';

let server: Server;
let base = '';

type Session = { cookies: Map<string, string> };
const newSession = (): Session => ({ cookies: new Map() });

async function call(session: Session, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {};
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers['content-type'] = 'application/json';
  const csrf = session.cookies.get('tl_csrf');
  if (csrf) headers['x-csrf-token'] = csrf;
  if (session.cookies.size) headers.cookie = [...session.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: isForm ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
  });
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(';');
    const [name, value] = (pair ?? '').split('=');
    if (name && value) session.cookies.set(name, value);
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

/** Download the archive as raw bytes, with the response headers that came with it. */
async function download(session: Session): Promise<{ status: number; headers: Headers; bytes: Buffer }> {
  const headers: Record<string, string> = {};
  if (session.cookies.size) headers.cookie = [...session.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const response = await fetch(`${base}/api/export`, { headers });
  return {
    status: response.status,
    headers: response.headers,
    bytes: Buffer.from(await response.arrayBuffer()),
  };
}

/** Every entry, decompressed. This is the whole point: the archive has to be readable. */
function unzip(bytes: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    fromBuffer(bytes, { lazyEntries: true }, (error, zip?: ZipFile) => {
      if (error || !zip) return reject(error ?? new Error('not a zip'));
      const files = new Map<string, Buffer>();
      zip.on('entry', (entry: Entry) => {
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError ?? new Error('no stream'));
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => {
            files.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
          stream.on('error', reject);
        });
      });
      zip.on('end', () => resolve(files));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

before(async () => {
  await migrate();
  await initStorage(3);
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

after(async () => {
  server?.close();
  await pool.end();
});

describe('export', () => {
  it('produces an archive that opens, reads, and refers to its own photos correctly', async () => {
    const user = await signup('Exporter');
    await call(user, 'POST', '/api/couples', { title: 'Vero & Naina', startedOn: '2021-02-14' });

    // Content chosen to break naive implementations: an accent in the title and the location, a
    // quote, an apostrophe, raw HTML, a newline, and a date recorded only to the month.
    const trip = await call(user, 'POST', '/api/events', {
      type: 'trip',
      title: 'Antsirabé — the "long" train',
      description: 'Line one.\nWith <b>html</b> & an apostrophe’s trouble.',
      eventDate: '2022-04-02',
      endDate: '2022-04-05',
      location: 'Antsirabé',
      mood: 'joyful',
      tags: ['rail'],
    });
    assert.equal(trip.status, 201);
    const fuzzy = await call(user, 'POST', '/api/events', {
      type: 'memory', title: 'Sometime that summer', eventDate: '2023-07-01', datePrecision: 'month',
    });
    assert.equal(fuzzy.status, 201);

    const result = await download(user);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('content-type'), 'application/zip');
    assert.match(result.headers.get('content-disposition') ?? '', /^attachment; filename="timeline-\d{4}-\d{2}-\d{2}\.zip"$/);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    // 'PK': it is a zip before anything else is worth asserting.
    assert.equal(result.bytes.subarray(0, 2).toString(), 'PK');

    const files = await unzip(result.bytes);
    assert.deepEqual([...files.keys()].sort(), ['README.txt', 'timeline.html', 'timeline.json']);

    const data = JSON.parse(files.get('timeline.json')!.toString('utf8'));
    assert.equal(data.format, 'timeline-export/1');
    assert.equal(data.couple.title, 'Vero & Naina');
    assert.equal(data.memories.length, 2);
    // Verbatim, not mangled on the way out.
    assert.equal(data.memories[0].title, 'Antsirabé — the "long" train');
    assert.equal(data.memories[0].description, 'Line one.\nWith <b>html</b> & an apostrophe’s trouble.');
    assert.equal(data.memories[0].location, 'Antsirabé');
    assert.deepEqual(data.memories[0].tags, ['rail']);
    // Precision travels with the date, so nobody later invents a day this did not happen on.
    assert.equal(data.memories[1].datePrecision, 'month');
    // Oldest first: an archive is read forwards.
    assert.deepEqual(data.memories.map((m: { date: string }) => m.date), ['2022-04-02', '2023-07-01']);
    // The anniversary is derived from the profile, and belongs in the record.
    assert.equal(data.yearlyDates.some((d: { kind: string }) => d.kind === 'anniversary'), true);

    const html = files.get('timeline.html')!.toString('utf8');
    // Escaped, not injected: a description is text.
    assert.ok(html.includes('&lt;b&gt;html&lt;/b&gt;'), 'raw HTML must be escaped in the page');
    assert.ok(!html.includes('<b>html</b>'), 'and must not survive as markup');
    assert.ok(html.includes('Antsirabé'), 'accents intact');
    // A fuzzy date must not be rendered as a false exact one.
    assert.ok(html.includes('2023-07') && !html.includes('2023-07-01'), 'month precision stays a month');
    // No script, no fetch, nothing to load but the photos beside it.
    assert.ok(!/<script/i.test(html), 'the readable copy must not depend on JavaScript');
    assert.ok(!/https?:\/\//i.test(html.replace(/Exported [^<]*/g, '')), 'and must not depend on the network');
  });

  it('names photos so they make sense on their own, and the page points at them', async () => {
    const user = await signup('Photographer');
    await call(user, 'POST', '/api/couples', {});
    const created = await call(user, 'POST', '/api/events', {
      type: 'trip', title: 'Nosy Bé', eventDate: '2024-08-03',
    });
    const eventId = created.body.event.id;

    const form = new FormData();
    // A real image, because uploads are decoded and re-encoded — what matters here is that the
    // stored object comes back out of the archive intact.
    const png = await sharp({
      create: { width: 240, height: 160, channels: 3, background: { r: 190, g: 120, b: 110 } },
    })
      .png()
      .toBuffer();
    form.append('photos', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'one.png');
    const upload = await call(user, 'POST', `/api/events/${eventId}/photos`, form);
    assert.equal(upload.status, 201, JSON.stringify(upload.body));

    const files = await unzip((await download(user)).bytes);
    const photos = [...files.keys()].filter((name) => name.startsWith('photos/'));
    assert.equal(photos.length, 1);
    // Date first so the folder sorts chronologically, accents folded so the name is safe anywhere.
    assert.match(photos[0]!, /^photos\/2024-08-03-nosy-be-1\.webp$/);
    assert.ok(files.get(photos[0]!)!.length > 0, 'the photo has to actually be in there');

    /*
     * The bug this test exists for: timeline.html sits at the root of the archive, so its <img src>
     * has to keep the 'photos/' prefix. It did not, and every image in the exported page was broken
     * while every other assertion passed.
     */
    const html = files.get('timeline.html')!.toString('utf8');
    assert.ok(html.includes(`src="${photos[0]}"`), 'the page must point at the file that is there');

    const data = JSON.parse(files.get('timeline.json')!.toString('utf8'));
    assert.deepEqual(data.memories[0].photos, [photos[0]]);
  });

  it('exports one couple and never another', async () => {
    const owner = await signup('Owner');
    await call(owner, 'POST', '/api/couples', { title: 'Theirs' });
    await call(owner, 'POST', '/api/events', {
      type: 'memory', title: 'A private thing', eventDate: '2020-01-01',
    });

    const outsider = await signup('Outsider');
    await call(outsider, 'POST', '/api/couples', { title: 'Ours' });

    const files = await unzip((await download(outsider)).bytes);
    const everything = [...files.values()].map((b) => b.toString('utf8')).join('\n');
    assert.ok(!everything.includes('A private thing'), "one couple's export cannot hold another's");
    assert.ok(!everything.includes('Theirs'));
    assert.ok(everything.includes('Ours'));
  });

  it('needs a session and a relationship', async () => {
    assert.equal((await fetch(`${base}/api/export`)).status, 401);
    const alone = await signup('Alone');
    const result = await download(alone);
    assert.equal(result.status, 403, 'no relationship, nothing to export');
  });
});
