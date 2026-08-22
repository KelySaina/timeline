# Timeline

A private, shared relationship timeline for two people. Not a date tracker with a feed bolted on —
the relationship itself is the record, told in order.

<p><em>Vue 3 · Vite · Tailwind CSS v4 · Express 5 · PostgreSQL 17 · Docker</em></p>

## Run it

```bash
./setup.sh --start   # generates secrets, picks free ports, builds, starts
```

Then open the URL it prints (http://localhost:4280 unless that port was taken). Add `--seed` for a
demo couple with a few years of story.

## Deploy on a server

```bash
./setup.sh --check                                   # audit first: docker, ports, secret strength
./setup.sh --domain timeline.example.com --start      # configure, build, run
```

`setup.sh` is idempotent and does the boring-but-easy-to-get-wrong parts:

- **Secrets** — generates alphanumeric values for `SESSION_SECRET`, the database password and both
  MinIO credentials, writes `.env` mode 600, and *preserves* anything already in use. It refuses to
  configure a public deployment while placeholder secrets remain.
- **Ports** — probes every host port it needs and shifts to the next free one, so it does not fight
  whatever else lives on the box. Ports this stack already publishes are recognised as its own.
- **`--domain`** — sets `WEB_ORIGIN`, turns on `COOKIE_SECURE`, and binds the web container to
  `127.0.0.1` so your TLS proxy is the only thing exposed. It then prints the remaining manual
  steps: terminate TLS, forward `X-Forwarded-Proto`, keep 80/443 the only open ports.
- **`--rotate`** — replaces weak secrets on a stack that already has data: `ALTER USER` for
  Postgres, a forced re-issue of the MinIO key, and a new `SESSION_SECRET` (which signs everyone
  out — the point of rotating it).

Nothing but the web port is ever published; Postgres and MinIO stay on the internal compose network.

Demo accounts after seeding: `alex@timeline.love` / `mira@timeline.love`, password
`loveletters2024`.

### Development (hot reload, database reachable from the host)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Or run the apps on the host against the containerised database:

```bash
# The dev overlay is what publishes the database on the host (port 55433) — the base stack
# deliberately keeps it unpublished, so plain `docker compose up` leaves host tooling without it.
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db
npm install
npm run dev            # api on :4281, web on :4280
npm test               # API integration suite (local storage driver)
npm run test:s3        # the same suite against MinIO, exercising the S3 driver
npm run visual         # browser pass over a running stack; writes ./screens
```

## Layout

```
apps/api        Express 5 + TypeScript. modules/ (auth, couples, events, photos, recurring),
                middleware/, db/ (pg pool + SQL migrations). No ORM, no codegen.
apps/web        Vue 3 SPA. components/, views/, stores/ (Pinia), composables/, api/ (one client).
infra/nginx     Serves the built SPA and proxies /api.
infra/minio     Bootstrap: creates the private bucket and the API's scoped key.
docs/DESIGN.md  Product analysis, MVP scope, flows, schema, architecture, edge cases, decisions.
```

## Deployment (CI/CD)

Same shape as the other apps on this box: tests gate everything, images go to GHCR, and a push to
`main` deploys itself over SSH.

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) — `paths-filter` skips work that
cannot have broken, then:

1. **test-api** — Postgres service container plus a MinIO container, running the suite against
   **both** storage drivers (`npm test` and `npm run test:s3`), because only one of them runs in
   production and the photo path differs between them.
2. **test-web** — `vue-tsc` + `vite build`.
3. **build-and-push** — `ghcr.io/kelysaina/timeline-{api,web}` tagged `:<sha>` and `:latest`,
   layer-cached, built from the repo root (the Dockerfiles install the npm workspace).
4. **deploy** — SSH to the VPS and run [`scripts/deploy.sh`](scripts/deploy.sh): sync the repo to
   the SHA, preflight, pull, recreate `api` + `web`, poll `https://$APP_DOMAIN/api/health`, and
   **roll back to the last good SHA** on failure.

`deploy.sh` reuses `./setup.sh --check` as its preflight instead of re-implementing "is this
configuration safe", so a placeholder secret or a missing Traefik network fails in a second rather
than after a two-minute health timeout. When the health check fails it also probes
`127.0.0.1:$WEB_PORT` and says so if the app is up but the *hostname* is not — that is a routing
problem, not a bad deploy, and the distinction is invisible otherwise.

**Rollback does not cover the database.** Migrations run at API boot and are forward-only, so a bad
migration needs a hand-written reverse migration; reverting the images will not undo it.

### Routing

[`docker-compose.prod.yml`](docker-compose.prod.yml) attaches `web` to the Traefik network that
already exists on the host (`PROXY_NETWORK`, default `izyah`) and adds the router labels for
`APP_DOMAIN`. Traefik owns TLS and ACME for every app on the box, so this project ships no
certificate handling of its own. `setup.sh --domain` fills in `APP_DOMAIN`, `WEB_ORIGIN`,
`COOKIE_SECURE=true`, and binds the container to `127.0.0.1`.

### First deploy on a new box

```bash
# on the server
git clone https://github.com/KelySaina/timeline.git ~/timeline && cd ~/timeline
./setup.sh --domain timeline.example.com     # generates secrets, writes .env, picks ports
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Then in the repo settings (or with `gh`): `SSH_HOST`, `SSH_USER`, `SSH_KEY`, and optionally
`SSH_PORT`. No `GHCR_PAT` is needed — the workflow's own `GITHUB_TOKEN` can pull the images for the
duration of the run; set one only if you also want to `docker pull` by hand on the box.

[`.github/workflows/prune-images.yml`](.github/workflows/prune-images.yml) keeps the two most recent
image versions weekly: what is deployed, plus `deploy.sh`'s rollback target.

## Photo storage

Photos live in MinIO (`S3`-compatible), behind a driver in `apps/api/src/modules/photos/storage/`:

- `STORAGE_DRIVER=s3` — MinIO in Docker, and real S3 or R2 with nothing but an endpoint change.
- `STORAGE_DRIVER=local` — a directory, for running the API on the host without Docker.

**Object storage is not a security upgrade over a private volume, and it is not sold as one here.**
In both cases the only path to a byte is `GET /api/photos/:id`, behind the session cookie and the
couple check — no public URL and no presigned URL exists. MinIO is here because a local volume
cannot be shared across API replicas and its backup story is a manual `tar`.

What keeps MinIO from being *worse* than the volume it replaced (`infra/minio/bootstrap.sh`):

- the bucket is asserted **private** on every boot — the one setting whose drift leaks photos;
- the API gets a **scoped key** (read/write objects in one bucket, no admin, no bucket creation),
  never the root credentials;
- versioning is enabled where the deployment supports it;
- neither the S3 port nor the console is published by the base stack — the dev overlay binds both to
  `127.0.0.1` only.

MinIO is AGPLv3; running it unmodified as part of your own service is fine, but worth knowing.

## Live updates

`GET /api/stream` is a server-sent event stream, opened once per tab for as long as a couple is
signed in. Server-sent rather than a WebSocket because the traffic only ever flows one way — the
client still writes over the ordinary REST endpoints — so it rides the session cookie unchanged,
needs no protocol upgrade through nginx or Traefik, and the browser owns the reconnect.

Three properties are worth knowing, because each one is load-bearing:

- **It carries no content.** A frame says `event.created`, a couple id and a row id — never a title,
  never a photo. The client then re-reads through `GET /api/events/:id`, so the couple check stays on
  the read path exactly as it is for a first-party fetch, and a stream can never become a way to
  read something an endpoint would have refused.
- **Fan-out goes through Postgres `LISTEN`/`NOTIFY`**, not an array of response objects in one
  process. A memory written by the replica holding partner A's connection has to reach the replica
  holding partner B's, and the database is already the thing every replica shares. No Redis, no cron.
  The `LISTEN` connection is its own client (a pooled one would never be released) and reconnects
  with a backoff, so a database restart costs live updates for a second, not the API.
- **A tab does not hear its own writes.** Mutations send `X-Client-Id`; the stream announces the same
  id as `?client=`. The originating tab already applied the server's response, so replaying it would
  fight local state — while the same person's *other* devices still update.

`token_version` is re-checked on every heartbeat (25s), so signing out everywhere closes the pipe
instead of only refusing the next fetch. A backgrounded phone suspends the stream and there is no
replay, so returning to the app re-reads the window on screen rather than trusting the connection.

## Installing it (PWA)

`apps/web/public/` holds the manifest, the icon set and a hand-written service worker. Hand-written
because the failure mode of a generated precache manifest is a stale shell that outlives the deploy,
and Vite's asset filenames are already content-hashed — runtime caching is enough:

| Request | Strategy | Why |
| --- | --- | --- |
| `/api/*` | **never cached** | The couple's private data. A cache would outlive signing out — and photos come through `/api/photos/:id`. |
| `/assets/*` | cache-first, forever | Content-hashed, so a new build asks for new filenames. |
| navigation | network-first, cached shell as fallback | An offline launch opens the app, not a browser error. |

The worker is **not registered by the dev server** — a worker that outlives a `vite build` preview
and then serves its shell to `vite dev` is the classic way to lose an hour to a change that was
already correct. Updates are offered rather than forced: the new worker activates immediately, and
the open page keeps its version until the reader takes the "Reload" toast, because reloading
someone mid-sentence in the composer is worse than running one build behind.

Timeline data is deliberately **not** available offline: caching it would mean the couple's story
sitting in a cache that survives sign-out. Offline gets you the shell and a failed fetch.

## What it does

- **Timeline** — every event in date order, grouped by year, filtered by type or year, read newest
  first or from the beginning. A memory added today for April 2024 lands in April 2024.
- **Add a memory in seconds** — date → type → title → save. Story, photos, place, mood and tags are
  one tap away and always optional.
- **Fuzzy dates** — "sometime in 2019" is a real answer; precision is stored, not invented.
- **Upcoming** — anniversaries and birthdays derived from the couple's own profile, plus future
  plans, with countdowns. Yearly dates are computed on read, so nothing drifts.
- **Photos** — multiple per memory, re-encoded server side, thumbnails for the timeline, delivered
  through the API and never from a public URL.
- **Two people, one story** — one live invite link at a time, single use, 14-day expiry.
- **Live, without a refresh** — a memory one partner writes appears on the other's timeline in its
  chronological place, and a theme they pick repaints both screens. Same for edits, deletions,
  photos, profiles and upcoming dates.
- **Installable** — a real home-screen app: standalone window, themed status bar, an "Add a memory"
  shortcut, and a shell that opens offline instead of a browser error page.
- **A theme store** — 27 themes in 8 collections (daylight, evening, flowery, antique, neon,
  mechanical, cosmic, elemental), browsed from live preview tiles on the *Us* screen. Every colour
  in the app, including the nine event-type accents, comes from the theme's token set, and the
  theme belongs to the relationship rather than the device.
- **Motifs and motion** — each theme paints up to three decorative layers behind the app (a tiled
  motif, a gradient veil, one glow) driven purely by CSS variables: petals fall, gears creep, rain
  runs down Tokyo, stars twinkle. All of it stops under `prefers-reduced-motion`.

## Security posture

- Session in an httpOnly cookie + double-submit CSRF token; scrypt password hashing; `token_version`
  for wholesale revocation.
- **The couple id always comes from the session.** No endpoint accepts one from the client, so
  cross-couple access is not a check that can be forgotten — it is unreachable by construction.
- Uploads are decoded and re-encoded (client mime types are ignored), capped at 8 MB and 10 per
  memory, and stored on a private volume with keys validated against traversal.
- Every request body, query and route parameter is validated with Zod before a handler sees it.
- The page CSP is included per nginx location, not declared once at server level. `add_header` is not
  additive in nginx: a location that sets any header of its own silently drops every inherited one,
  which is how the document itself can end up as the only response *without* a CSP.
- The change stream carries no content and re-checks `token_version` on every heartbeat, so it can
  neither leak what an endpoint would refuse nor outlive the session that opened it.

`npm test` covers the ordering guarantees and the isolation ones: a second couple holding real event
and photo ids gets 404s on read, write, and delete.

## Not built yet (by design)

AI recaps, "on this day", bucket lists, exports, print, video and voice memories, push
notifications, sharing. `docs/DESIGN.md` §8 records where each one attaches.

`recurring_events.remind_days_before` is stored and editable but nothing sends anything yet: the
service worker that landed with the PWA is the delivery channel that was missing, so push is now a
subscription table and a scheduler away rather than a from-scratch build.
