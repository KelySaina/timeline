# Timeline — a shared relationship story

> MVP design document. Written before the code; kept in sync with it.

## 1. Product analysis

The insight worth building around: **the killer feature is not the calendar, it is the relationship
becoming a chronological story.** A date tracker answers *"when is our anniversary?"*. A story
answers *"who are we?"* — and that is the thing a couple keeps for years.

Three consequences drive every decision below:

1. **The timeline is the product.** Not a dashboard with a timeline widget. The first screen is the
   story, and everything else (upcoming dates, search, profile) is a lens on it.
2. **The past is the corpus, the future is a promise.** Both live in the same table, but they are
   never mixed in the same scroll. Past = story. Future = anticipation.
3. **Writing must cost nothing.** A memory that takes 90 seconds to add never gets added. Target:
   date → type → title → save, in under 10 seconds, with everything else optional.

What this is *not*: a social network (no followers, no likes, no discovery), a photo backup, or a
messaging app. Two people, one story, private by default.

## 2. MVP scope

**In**

| Area | Shipped in MVP |
| --- | --- |
| Auth | Email + password, httpOnly cookie session, CSRF double-submit |
| Couple | Create relationship, invite code / link, partner joins, one active couple per user |
| Timeline | Chronological events grouped by year, type + year filters, scroll reveal |
| Events | 9 types, date + fuzzy precision, title, description, location, mood, tags, multi-photo |
| Add memory | 4-step sheet (date → type → title → optional), quick-start presets |
| Detail | Full-screen memory view, photo gallery with lightbox, author + timestamps |
| Upcoming | Recurring anniversaries/birthdays/custom + future-dated events, countdown |
| Profile | Both partners, avatars, start date, together-for counter, memory/trip/milestone counts |
| Search | Title, description, tags, location |
| Photos | Private storage, authenticated delivery, server-side thumbnails |
| Empty state | "Your story starts here" + 5 guided first memories |
| Themes | 27 themes in 8 collections, per couple, browsed in a theme store with live preview tiles |

**Out (deliberately)** — AI recaps, "on this day", bucket list, date ideas, exports, print, video,
voice, letters, challenges, widgets, push/email delivery, multiple relationships per user, themes
beyond the default, comments/reactions. Each is listed in §8 with the seam it will attach to.

Themes started as one of those deferrals and moved in early: the whole UI already read its colour
from one token set, so a theme is ~20 variables and no component changes. Two structural changes
were needed. `--on-ember` (what sits *on* the accent), because white text is unreadable on the gold
and periwinkle accents, so the pairing has to belong to the theme. And the nine event-type hues
became formulas rather than lists: each anchors a semantic hue, bends toward the theme's accent by
`--type-mix`, and lifts toward `--type-tone` by `--type-lift` on dark paper — which is what keeps
a theme down to a dozen lines once you have twenty-seven of them.

Motifs came with the same discipline. A theme declares up to three layers (`--motif-*` a tiled SVG
mask painted in the theme's colour, `--veil-*` a tiled gradient, `--glow-*` one un-tiled gradient)
and `ThemeAtmosphere` renders them without knowing which theme is on. Two subtleties are worth
recording, because both looked like "the motifs don't work":

- Anything declared on `:root` applies to `<html>` under *every* theme, so dawn's hand-pinned type
  hues and its paper grain had to move to `.theme-dawn`. Dawn is reachable as both.
- A negative-`z-index` layer paints above the root element's background but *below* the `<body>`
  box's. The page ground therefore lives on `html` alone; an opaque `body` background buried every
  motif in the app while the store's tiles showed them perfectly.

## 3. Main user flows

```
A. First run          signup → create relationship (names + start date) → invite code
                                                    ↓
B. Partner joins      signup → enter code / open /join/:code → same timeline
                                                    ↓
C. Add a memory       FAB → date → type → title → [photos/description/location/mood/tags] → save
                      (optimistic insert, animates into its chronological slot)
D. Relive             timeline → tap event → detail → swipe photos → close
E. Anticipate         Upcoming → "Your anniversary is in 12 days" → tap → detail / add plan
F. Recall             Search → query → results grouped by year → tap → detail
```

Flow C is the one that gets optimised to death. Everything after "title" is optional and reachable
in one scroll of the same sheet — no wizard, no second screen.

## 4. Data model

Postgres. Eight tables, all couple-scoped rows carry `couple_id` so authorization is a single
predicate rather than a join walk.

```
users ──┬── couple_members ──┬── couples ──┬── events ──┬── event_photos
        │                    │             │            └── event_tags
        └── (avatar_key)     │             ├── recurring_events
                             │             └── invitations
```

| Table | Purpose | Notes |
| --- | --- | --- |
| `users` | account | `email` unique (lowercased), `password_hash` (scrypt, Node core), `display_name`, `birthday`, `avatar_key`, `token_version` |
| `couples` | the relationship | `title`, `started_on`, `theme`, `story_layout`, `created_by` |
| `couple_members` | membership | PK `(couple_id, user_id)`, `role` owner/partner, `left_at`; partial unique on `user_id WHERE left_at IS NULL` → one active couple per user |
| `invitations` | join by code | `code` unique (base32, 10 chars), `expires_at`, `accepted_by`, `revoked_at` |
| `events` | the story | `couple_id`, `event_date`, `end_date`, `date_precision` (day/month/year), `type`, `title`, `description`, `location`, `mood`, `created_by`, `created_at`, `updated_at`, `deleted_at` |
| `event_photos` | images | `couple_id` denormalised for authz, `storage_key`, `thumb_key`, `width`, `height`, `byte_size`, `position` |
| `event_tags` | tags | PK `(event_id, tag)`, tag normalised lowercase |
| `recurring_events` | yearly dates | `kind` (anniversary/birthday/custom), `month`, `day`, `start_year`, `source` + `source_user_id`, `remind_days_before` |

**Date handling.** `event_date` is a `DATE`, never a timestamp — a first kiss happened on a calendar
day, not at a UTC instant, and it must not shift because the couple flew to Madagascar. Ordering is
`event_date` (+ `created_at` tiebreak), so a memory added today for April 2024 lands in April 2024.
`date_precision` lets "sometime in 2019" exist without inventing a fake day: stored as
`2019-01-01` + `precision=year`, rendered as "2019". Recurring dates are stored as `(month, day)`
and the next occurrence is computed per request — no cron, no drift, no DST.

`event_date` positions the story; `created_at` / `updated_at` are metadata shown in the detail view
("added by Thierry, 3 days ago"). They are never mixed.

## 5. Application architecture

```
apps/web  Vue 3 SPA (Vite, Tailwind v4, Pinia, Font Awesome)  ──http──▶  apps/api
                                                                            │
                                                            Express 5 + TypeScript
                                                            ├── modules/ (auth, couples, events,
                                                            │            photos, recurring, search)
                                                            ├── middleware/ (session, coupleContext,
                                                            │                validate, csrf, errors)
                                                            └── db/ (pg pool + SQL migrations)
                                                                            │
                                              Postgres 17   +   MinIO (private bucket, S3 API)
```

Photo bytes sit behind a driver (`modules/photos/storage/`): `local` writes to a directory for host
development, `s3` talks to MinIO — and to real S3 or R2 with only an endpoint change. Both are
selected by `STORAGE_DRIVER` and expose the same five operations, so nothing above them knows which
one is running.

Deliberately boring: no ORM codegen, no GraphQL, no microservices. Each module is
`routes → service → sql`, so a future feature is a new folder, not a refactor. Business rules live
in services; routes only validate, authorize, and shape responses.

The keystone is `coupleContext`: it resolves the caller's *active couple from the session*, attaches
it to `req.couple`, and every couple-scoped query takes `couple_id` from there. **A couple id from
the client is never trusted** — the API has no route that accepts one.

## 6. Component architecture

```
App
├── AppShell            frame, bottom nav (mobile) / rail (desktop), toasts
├── views/
│   ├── AuthView        sign in / sign up
│   ├── OnboardView     create relationship · join with code
│   ├── TimelineView    the hero
│   ├── UpcomingView    countdowns + future plans
│   ├── SearchView
│   └── ProfileView     couple profile + invite + stats
└── components/
    ├── Timeline            year grouping, sticky year chip, reveal-on-scroll
    ├── TimelineEvent       rail node + MemoryCard
    ├── MemoryCard          date badge, type glyph, title, excerpt, photo strip
    ├── MemoryModal         detail view
    ├── PhotoGallery        collage + lightbox, lazy + thumbnails
    ├── EventForm           the 10-second add sheet
    ├── CoupleHeader        names, avatars, together-for counter
    ├── UpcomingEvents      countdown list
    ├── DateBadge           precision-aware date rendering
    ├── EmptyTimeline       "Your story starts here" + quick starts
    └── CoupleInvite        code, copy, share link
```

Logic lives in `composables/` (`useTimeline`, `useCountdown`, `useRelativeDate`, `usePhotoUpload`)
and `stores/` (`auth`, `couple`, `timeline`). Components render; they don't fetch. Every API call
goes through `api/client.ts`, so auth, CSRF, and error normalisation exist in exactly one place.

## 7. Edge cases considered

- **Solo couple.** The timeline works fully before a partner joins; the invite is a nudge, not a gate.
- **Empty timeline.** Guided quick starts, never a blank dashboard.
- **Backdated writes.** Insert position is derived from `event_date`, not insertion order.
- **Future events.** `event_date > today` ⇒ excluded from the story scroll, surfaced under Upcoming.
- **Fuzzy dates.** `precision=month|year` renders "March 2024" / "2019" and sorts stably.
- **Multi-day trips.** `end_date` renders as a range and anchors on the start date.
- **Feb 29 recurrences.** Non-leap years resolve to Feb 28.
- **Anniversary before a start date exists.** No `started_on` ⇒ no anniversary card, prompt instead.
- **Code reuse / expiry.** Invitations single-use, 14-day expiry, revocable, one active per couple.
- **Second couple.** Partial unique index rejects joining while an active membership exists.
- **Deleted partner content.** Events survive their author; the author label degrades gracefully.
- **Photo abuse.** Type sniffed by decoder (not by client mime), 8 MB cap, 10 per event, re-encoded.
- **Cross-couple access.** Every photo, event, tag, and recurring row is filtered by `req.couple.id`.
- **Object store down vs object missing.** A missing key is a 404; an unreachable store is a 500 —
  they are distinguished so an outage never looks like a deleted memory.
- **Timezones.** Calendar dates stay calendar dates end to end; "today" is resolved client-side.
- **Soft delete.** `deleted_at` keeps the story recoverable; queries filter it out.
- **A tab hearing its own write.** Skipped by `X-Client-Id` / `?client=`; the same person's other
  devices are not the origin, so they still update.
- **A filtered timeline receiving a memory.** The client cannot decide locally whether it belongs in
  a filtered list, so a filtered view re-asks the server instead of guessing.
- **A future-dated memory arriving live.** `absorb()` keeps it out of the story scroll, and the count
  follows what actually landed rather than assuming a create always adds a row.
- **A backgrounded phone.** The stream is suspended and there is no replay, so regaining visibility
  re-reads the window already on screen — without snapping the reader back to the top.
- **A session revoked while a stream is open.** `token_version` is re-checked every heartbeat, so
  signing out everywhere closes the pipe rather than only refusing the next fetch.
- **Shutdown with streams open.** `server.close()` waits for open connections and an SSE response
  never ends by itself, so the streams are closed first — otherwise deploys stall until SIGKILL.
- **A stale shell after a deploy.** The worker never serves `index.html` from cache first, and the
  dev server never registers a worker at all.
- **A layout whose data is empty.** The route map with no locations and the heartline with no moods
  both still draw something honest, and the gallery warns before you pick rather than after.
- **A year holding one memory in the album.** Falls back to a single full-width block instead of one
  lonely box in a field of white.
- **The album closing its own gaps.** Never with `grid-auto-flow: dense` — it reorders, and
  chronology is the product. A lone half-width block is widened instead.
- **An unknown layout value.** `storyLayoutMeta()` falls back to the rail rather than rendering
  nothing, so a couple on a newer build than the SPA still sees their story.

### Is an object store more secure than a Docker volume?

No — and it is worth being blunt about it, because it is the wrong reason to adopt one. Neither
design exposes a public URL: in both, the only route to a byte is `GET /api/photos/:id` behind the
session and the couple check, and neither encrypts at rest by default. MinIO in fact *adds* a risk
the volume does not have — a bucket policy that can be set to anonymous, a console and an S3 port
that can be published by accident, and credentials to rotate.

MinIO is here for durability and scale: a local volume cannot be shared by more than one API
replica, and its backup story is a manual `tar`. The mitigations that keep the swap from being a net
loss are in `infra/minio/bootstrap.sh` — the bucket is asserted private on every boot, versioning is
enabled where the deployment supports it, and the API is issued a key scoped to one bucket instead
of root credentials.

## 8. Technical decisions

| Decision | Why | Future seam |
| --- | --- | --- |
| Postgres + hand-written SQL migrations | Explicit relational model, zero codegen surprises, portable | Add migrations; swap in an ORM later if it earns its place |
| `DATE` + `date_precision`, never timestamps for events | A memory belongs to a day, not an instant | Optional `event_time` column |
| Recurrences computed on read from `(month, day)` | No cron, no drift, correct across DST and leap years | Job that turns the same computation into notifications |
| Session in httpOnly cookie + CSRF double-submit | No token in JS ⇒ XSS can't exfiltrate the session | `token_version` already allows global revoke |
| `couple_id` from session only | Removes the entire class of IDOR bugs | Any new couple-scoped table inherits it |
| Photos in MinIO behind a storage driver | Shared by several API replicas, backed up and mirrored with `mc`; identical API for S3/R2 later | The `local` driver stays for single-host runs |
| Bytes still streamed through the API — no presigned URLs | Authorization applies to every request, not to a URL that outlives the check | Presigning is possible later, but it moves the check off the hot path |
| MinIO gets a scoped service account, never root | A leaked API key can read and write one bucket and nothing else | Per-tenant prefixes/keys if this ever goes multi-region |
| Server-side thumbnails (sharp, webp) | Timeline stays fast on mobile data | Video posters reuse the pipeline |
| Soft delete + `created_by` on events | Enables "on this day", recaps, and undo later | — |
| Vue SPA + Pinia, no SSR | Private app, nothing to index, simplest deploy | PWA/offline is additive |
| Story layout is a column on `couples`, like `theme` | The shape belongs to the relationship, not the device, and rides the existing change stream | Adding a layout is one migration editing one check constraint |
| `text` + check constraint, not a Postgres enum | `ALTER TYPE` cannot be rolled back inside a transaction; a check can | Same pattern as `theme` |
| Layouts derive their shape from existing columns | No new writing burden on the couple: the gap between dates, a location, a photo count and a mood are already there | A layout needing new data would need a new field first |
| One SVG segment per memory, not one path per year | A single path needs measured card heights and tears on reflow; a stretched per-row segment cannot | — |
| Docker Compose (db + api + web) | One command to run the whole stack | Same images deploy to a real host |
| Live updates over SSE, not WebSocket | Traffic is one-directional, rides the session cookie, needs no upgrade through nginx/Traefik, browser owns the reconnect | Bidirectional features (typing, presence) would need the upgrade |
| The stream carries a nudge, not content | Every update is re-read through the normal endpoint, so the couple check stays on the read path and a stream cannot leak what an endpoint would refuse | Payloads could carry rows later; the authz cost is the reason not to |
| Fan-out via Postgres `LISTEN`/`NOTIFY` | The API is meant to run as more than one replica, and the database is already the thing they share — no Redis, no cron | The same channel can drive a push worker |
| Hand-written service worker | A generated precache manifest's failure mode is a stale shell outliving the deploy; hashed asset names make runtime caching sufficient | Web push attaches to this worker |
| API responses never cached by the worker | A cache of private data would outlive signing out | Offline reads would need an explicit, wipe-on-logout store |
