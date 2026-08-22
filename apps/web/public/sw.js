/**
 * Timeline's service worker. Hand-written rather than generated, for one reason: the failure mode of
 * a precache manifest is a stale shell that outlives the deploy, and this app has no build-time list
 * it actually needs. Vite's asset filenames are content-hashed and therefore immutable, so runtime
 * caching alone is enough — and index.html is never served from cache first.
 *
 * The rules, in the order they matter:
 *   /api/*      never cached, not once. It is the couple's private data, and a cache would outlive
 *               signing out. Photos included — they come through /api/photos/:id — and so does the
 *               change stream, which must not sit behind a buffer.
 *   /assets/*   content-hashed, so cache-first forever; a new build asks for new filenames.
 *   navigation  network-first, falling back to the cached shell so an offline launch opens the app
 *               instead of the browser's error page.
 *
 * It also receives push. A notification is shown for every push that arrives, without exception:
 * every browser that supports web push requires a user-visible notification per message, and a
 * silent one costs the site its permission.
 */

const VERSION = 'v2';
const SHELL = `timeline-shell-${VERSION}`;
const STATIC = `timeline-static-${VERSION}`;
const SHELL_URL = '/index.html';

const PRECACHE = [
  SHELL_URL,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // One at a time, so a single missing file cannot fail the whole install.
      await Promise.all(
        PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, STATIC]);
      for (const name of await caches.keys()) {
        if (name.startsWith('timeline-') && !keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting();
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) void cache.put(request, response.clone());
  return response;
}

async function networkFirstShell(request) {
  try {
    const response = await fetch(request);
    // Keep the shell fresh for the next offline launch — but only ever the shell itself.
    if (response.ok) {
      const cache = await caches.open(SHELL);
      void cache.put(SHELL_URL, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(SHELL_URL, { cacheName: SHELL });
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Cross-origin (the Google font stylesheet) is left entirely to the browser.
  if (url.origin !== self.location.origin) return;

  // Private data, and a long-lived stream that must never sit behind a cache.
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/assets/')) return event.respondWith(cacheFirst(request));
  if (request.mode === 'navigate') return event.respondWith(networkFirstShell(request));

  // Icons, the manifest, favicons: cache when present, network otherwise.
  event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
});

/* ---------------------------------------------------------------------------------------------
 * Push
 * ------------------------------------------------------------------------------------------ */

/**
 * The payload is encrypted end to end and written by our own API, but it is still parsed
 * defensively: a push that arrives malformed — or with no body at all, which some services do when
 * they cannot carry one — must still show something rather than throw and show nothing.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = typeof data.title === 'string' && data.title ? data.title : 'Timeline';
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/';

  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      // Collapse on the tag the server chose, so a phone coming back online after several delivery
      // attempts shows one reminder rather than a stack of identical ones.
      tag: typeof data.tag === 'string' ? data.tag : undefined,
      renotify: false,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // Read back on click. Same-origin paths only — checked above, because this value decides
      // where a tap navigates.
      data: { url },
    }),
  );
});

/**
 * Focus the app if it is already open rather than opening a second window, and take it to the
 * screen the notification was about. `navigate()` is not available in every browser, so a failure
 * there still leaves the reader in a focused app.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ('navigate' in client) await client.navigate(url).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
