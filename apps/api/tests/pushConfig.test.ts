/**
 * What happens when push is configured badly.
 *
 * Its own file because `config/env.ts` reads the environment once per process, so the only way to
 * test a second configuration is a second process. The case is worth the file: a real deployment
 * ended up with a placeholder subject pasted in whole, twice — once obviously broken
 * (`mailto:YOUR_REAL_EMAIL`) and once not (`mailto:me@example.com`) — and a push service rejects the
 * first at send time, which for a reminder is next week, while accepting the second and having
 * nowhere to write to.
 *
 * The behaviour under test is the trade: refusing to boot would take every screen of the app down
 * for a feature nobody has switched on, so a bad subject leaves the API running with notifications
 * off, saying so.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
/*
 * A well-formed address at a domain RFC 2606 reserves for documentation. The harder of the two
 * failure modes: it passes every shape check, a push service accepts it, and then there is no way
 * to reach whoever runs the deployment. It got into a real .env by being pasted out of an example.
 */
process.env.VAPID_SUBJECT = 'mailto:me@example.com';

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { pushConfigured } = await import('../src/config/env.js');

let server: Server;
let base = '';

const cookies = new Map<string, string>();

async function call(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const csrf = cookies.get('tl_csrf');
  if (csrf) headers['x-csrf-token'] = csrf;
  if (cookies.size) headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(';');
    const [name, value] = (pair ?? '').split('=');
    if (name && value) cookies.set(name, value);
  }
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

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

describe('push with an unusable subject', () => {
  it('keeps the app running with notifications off, and says so', async () => {
    // The keys are real and present; only the contact URI is nonsense.
    assert.equal(pushConfigured, false, 'a placeholder subject must not count as configured');

    const signup = await call('POST', '/api/auth/signup', {
      email: `badsubject-${randomUUID()}@test.local`,
      password: 'a-long-enough-password',
      displayName: 'Misconfigured',
    });
    assert.equal(signup.status, 201, 'the rest of the API is unaffected');

    const state = await call('GET', '/api/push/state');
    assert.equal(state.status, 200);
    assert.equal(state.body.configured, false);
    assert.equal(state.body.publicKey, null, 'a key nothing can sign with is not worth handing out');

    // And subscribing is refused rather than silently storing an endpoint nothing will ever reach.
    const attempt = await call('POST', '/api/push/subscribe', {
      endpoint: 'https://push.test.local/send/abc',
      keys: { p256dh: Buffer.alloc(65, 4).toString('base64url'), auth: Buffer.alloc(16, 7).toString('base64url') },
    });
    assert.equal(attempt.status, 400);
  });
});
