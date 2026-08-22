/**
 * Everything, in one file you can keep.
 *
 * The point of this endpoint is not backup — the database is backed up — it is that a private
 * archive of irreplaceable things must never be hostage to the software holding it. So the archive
 * is built to outlive this app: structured data for a machine, the original photos as ordinary
 * files, and one self-contained page that renders the whole story in any browser, with no server,
 * no JavaScript and no network. Extract it in twenty years and it still reads.
 *
 * Three constraints shape the implementation.
 *
 * **It streams.** Ten photos per memory at up to 8 MB each is gigabytes for a long relationship,
 * and buffering that would kill the process. Every photo is added lazily, so exactly one object
 * stream is open at a time no matter how many there are, and the zip flows to the client as it is
 * built.
 *
 * **Photos are stored, not deflated.** They are already WebP; compressing them again spends CPU to
 * make the file marginally larger. Only the text entries are compressed, where it pays.
 *
 * **Entry sizes are not declared.** `event_photos.byte_size` records the stored length exactly, so
 * declaring it is tempting — but yazl aborts the whole archive with "unexpected number of bytes" if
 * a stream disagrees with its promised size, which turns one photo the object store has lost into a
 * corrupt export of everything else. Verified both ways before choosing: without a declared size
 * yazl writes a perfectly valid zip, and a missing photo simply becomes an empty entry.
 *
 * **Nothing is trusted to a client.** The couple id comes from the session like everywhere else,
 * and every row and object key is fetched under it.
 */
import { Readable } from 'node:stream';
import yazl from 'yazl';
import { query } from '../../db/pool.js';
import { ObjectNotFound, readObject } from '../photos/storage/index.js';

type CoupleRow = {
  id: string;
  title: string | null;
  started_on: string | null;
  theme: string;
  story_layout: string;
  created_at: string;
};

type MemberRow = { display_name: string; email: string; birthday: string | null; joined_at: string };

type EventRow = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  event_date: string;
  end_date: string | null;
  date_precision: string;
  location: string | null;
  mood: string | null;
  created_at: string;
  updated_at: string;
  author: string;
  tags: string[] | null;
};

type PhotoRow = {
  id: string;
  event_id: string;
  storage_key: string;
  width: number;
  height: number;
  byte_size: number;
  position: number;
};

type RecurringRow = { title: string; month: number; day: number; kind: string; remind_days_before: number };

/** Safe inside a filename on every platform, and still recognisable. */
function slug(value: string): string {
  const folded = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return folded.slice(0, 40) || 'memory';
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": '#39' }[c]};`);

/**
 * The readable copy: one page, no assets but the photos beside it, no script. Deliberately plain —
 * this file's job is to still work, not to look like the app. The app's themes are a live thing;
 * a printed page is not.
 */
function renderHtml(
  couple: CoupleRow,
  members: MemberRow[],
  events: EventRow[],
  photosByEvent: Map<string, { name: string; width: number; height: number }[]>,
  exportedAt: string,
): string {
  const names = members.map((m) => m.display_name);
  const heading = couple.title || names.join(' & ') || 'Our story';

  const years = new Map<string, EventRow[]>();
  for (const event of events) {
    const year = event.event_date.slice(0, 4);
    years.set(year, [...(years.get(year) ?? []), event]);
  }

  const sections = [...years.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([year, group]) => {
      const items = group
        .map((event) => {
          const photos = photosByEvent.get(event.id) ?? [];
          const figures = photos
            .map(
              (photo) =>
                `<img src="${escapeHtml(photo.name)}" alt="${escapeHtml(event.title)}" width="${photo.width}" height="${photo.height}" loading="lazy">`,
            )
            .join('\n          ');
          const when =
            event.date_precision === 'year'
              ? event.event_date.slice(0, 4)
              : event.date_precision === 'month'
                ? event.event_date.slice(0, 7)
                : event.event_date;
          return `      <article>
        <h3>${escapeHtml(event.title)}</h3>
        <p class="meta">${escapeHtml(when)}${event.end_date ? ` – ${escapeHtml(event.end_date)}` : ''} · ${escapeHtml(event.type)}${event.location ? ` · ${escapeHtml(event.location)}` : ''}${event.mood ? ` · ${escapeHtml(event.mood)}` : ''}</p>
        ${event.description ? `<p>${escapeHtml(event.description).replace(/\n/g, '<br>')}</p>` : ''}
        ${event.tags?.length ? `<p class="tags">${event.tags.map((t) => escapeHtml(t)).join(' · ')}</p>` : ''}
        ${figures ? `<div class="photos">\n          ${figures}\n        </div>` : ''}
        <p class="meta">Added by ${escapeHtml(event.author)}</p>
      </article>`;
        })
        .join('\n');
      return `    <section>\n      <h2>${year}</h2>\n${items}\n    </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0 auto; padding: 2rem 1.25rem 5rem; max-width: 44rem;
    font: 16px/1.65 Georgia, 'Times New Roman', serif;
    background: #fdfcfa; color: #241f1d;
  }
  header { border-bottom: 1px solid #d9d2cc; padding-bottom: 1.25rem; margin-bottom: 2.5rem; }
  h1 { font-size: 2rem; margin: 0 0 .35rem; }
  h2 {
    font-size: 1.5rem; margin: 3rem 0 1rem; padding-bottom: .3rem;
    border-bottom: 1px solid #e6dfd9; font-variant-numeric: tabular-nums;
  }
  h3 { font-size: 1.15rem; margin: 0 0 .25rem; }
  article { margin: 0 0 2.5rem; }
  .meta { font-size: .8rem; color: #6f6560; margin: .2rem 0; font-family: system-ui, sans-serif; }
  .tags { font-size: .8rem; color: #6f6560; font-family: system-ui, sans-serif; }
  .photos { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); gap: .5rem; margin: .75rem 0; }
  .photos img { width: 100%; height: auto; border-radius: 4px; display: block; }
  footer { margin-top: 4rem; border-top: 1px solid #d9d2cc; padding-top: 1rem; font-size: .8rem; color: #6f6560; font-family: system-ui, sans-serif; }
  @media (prefers-color-scheme: dark) {
    body { background: #16130f; color: #ece5dd; }
    header, footer { border-color: #3a332c; }
    h2 { border-color: #2e2822; }
    .meta, .tags, footer { color: #a89c92; }
  }
  @media print { body { max-width: none; } article { break-inside: avoid; } }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(heading)}</h1>
  <p class="meta">${escapeHtml(names.join(' and '))}${couple.started_on ? ` · since ${escapeHtml(couple.started_on)}` : ''} · ${events.length} ${events.length === 1 ? 'memory' : 'memories'}</p>
</header>
${sections || '    <p>No memories yet.</p>'}
<footer>
  Exported ${escapeHtml(exportedAt)} from Timeline. The photos sit beside this file, and
  <code>timeline.json</code> holds the same story as data.
</footer>
</body>
</html>
`;
}

const README = (heading: string, exportedAt: string, events: number, photos: number): string =>
  `${heading}
${'='.repeat(heading.length)}

Exported ${exportedAt}
${events} ${events === 1 ? 'memory' : 'memories'}, ${photos} ${photos === 1 ? 'photo' : 'photos'}

  timeline.html   the whole story as one page. Open it in any browser — no server,
                  no internet, no JavaScript. This is the copy meant for reading.
  timeline.json   the same story as structured data, for moving it somewhere else.
  photos/         every photo at full size, as ordinary WebP files. The names carry
                  the date and the title so they make sense on their own.

Nothing here needs Timeline to be running, or to exist.
`;

/**
 * Build the archive into a zip and return its output stream.
 *
 * Returns the stream rather than writing to a response, so the caller owns the HTTP concerns and
 * this stays testable without a socket.
 */
export async function buildExport(coupleId: string): Promise<{ stream: Readable; filename: string }> {
  const [couples, members, events, photos, recurring] = await Promise.all([
    query<CoupleRow>(
      'select id, title, started_on::text, theme, story_layout, created_at from couples where id = $1',
      [coupleId],
    ),
    query<MemberRow>(
      `select u.display_name, u.email, u.birthday::text, m.joined_at
         from couple_members m join users u on u.id = m.user_id
        where m.couple_id = $1 and m.left_at is null
        order by m.joined_at`,
      [coupleId],
    ),
    query<EventRow>(
      `select e.id, e.type, e.title, e.description, e.event_date::text, e.end_date::text,
              e.date_precision, e.location, e.mood, e.created_at, e.updated_at,
              u.display_name as author,
              (select array_agg(t.tag order by t.tag) from event_tags t where t.event_id = e.id) as tags
         from events e join users u on u.id = e.created_by
        where e.couple_id = $1 and e.deleted_at is null
        order by e.event_date, e.created_at`,
      [coupleId],
    ),
    query<PhotoRow>(
      `select id, event_id, storage_key, width, height, byte_size, position
         from event_photos where couple_id = $1 order by event_id, position, created_at`,
      [coupleId],
    ),
    query<RecurringRow>(
      `select title, month, day, kind, remind_days_before from recurring_events
        where couple_id = $1 order by month, day`,
      [coupleId],
    ),
  ]);

  const couple = couples[0];
  if (!couple) throw new Error(`No such couple: ${coupleId}`);

  const exportedAt = new Date().toISOString();
  // The machine-readable stamp goes in the JSON; the two files people read get the date alone.
  const exportedOn = exportedAt.slice(0, 10);
  const heading = couple.title || members.map((m) => m.display_name).join(' & ') || 'Our story';

  const zip = new yazl.ZipFile();

  // Names that make sense on their own, once the zip is extracted and the app is gone.
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const photosByEvent = new Map<string, { name: string; width: number; height: number }[]>();
  const entries: { key: string; name: string }[] = [];
  const seen = new Set<string>();

  for (const photo of photos) {
    const event = eventsById.get(photo.event_id);
    // A photo whose memory is deleted still has rows (delete is soft) but is not part of the story.
    if (!event) continue;
    let name = `photos/${event.event_date}-${slug(event.title)}-${photo.position + 1}.webp`;
    // Two memories can share a date and a title. The id is ugly but unambiguous.
    if (seen.has(name)) name = `photos/${event.event_date}-${slug(event.title)}-${photo.id}.webp`;
    seen.add(name);

    entries.push({ key: photo.storage_key, name });
    // Kept with its 'photos/' prefix: timeline.html sits at the root of the archive, so that is the
    // path both the page and the manifest need. Stripping it here made every image in the exported
    // page a broken one — the whole promise of that file is that it opens and works.
    photosByEvent.set(event.id, [
      ...(photosByEvent.get(event.id) ?? []),
      { name, width: photo.width, height: photo.height },
    ]);
  }

  zip.addBuffer(Buffer.from(README(heading, exportedOn, events.length, entries.length), 'utf8'), 'README.txt');
  zip.addBuffer(
    Buffer.from(renderHtml(couple, members, events, photosByEvent, exportedOn), 'utf8'),
    'timeline.html',
  );
  zip.addBuffer(
    Buffer.from(
      `${JSON.stringify(
        {
          exportedAt,
          // Named so a future reader knows what produced this and what shape to expect.
          format: 'timeline-export/1',
          couple: {
            title: couple.title,
            startedOn: couple.started_on,
            theme: couple.theme,
            storyLayout: couple.story_layout,
            createdAt: couple.created_at,
          },
          members: members.map((m) => ({
            displayName: m.display_name,
            email: m.email,
            birthday: m.birthday,
            joinedAt: m.joined_at,
          })),
          yearlyDates: recurring.map((r) => ({
            title: r.title,
            kind: r.kind,
            month: r.month,
            day: r.day,
            remindDaysBefore: r.remind_days_before,
          })),
          memories: events.map((event) => ({
            type: event.type,
            title: event.title,
            description: event.description,
            date: event.event_date,
            endDate: event.end_date,
            datePrecision: event.date_precision,
            location: event.location,
            mood: event.mood,
            tags: event.tags ?? [],
            author: event.author,
            createdAt: event.created_at,
            updatedAt: event.updated_at,
            photos: (photosByEvent.get(event.id) ?? []).map((p) => p.name),
          })),
        },
        null,
        2,
      )}\n`,
      'utf8',
    ),
    'timeline.json',
  );

  for (const entry of entries) {
    /*
     * Lazily, so exactly one object stream is open at a time however many photos there are. Opening
     * them all up front would mean hundreds of concurrent connections to the object store for a
     * long relationship.
     *
     * `compress: false`: WebP is already compressed, so deflating it spends CPU to make the archive
     * very slightly larger.
     */
    zip.addReadStreamLazy(entry.name, { compress: false }, (callback) => {
      readObject(entry.key).then(
        (object) => callback(null, object.stream),
        (error: unknown) => {
          // A file the store has lost must not cost the couple an archive of everything else. It
          // becomes an empty entry, and both the manifest and the page still name it — which is the
          // honest record: the memory had a photo, and the photo is gone.
          if (error instanceof ObjectNotFound) {
            console.warn('[export] photo missing from storage, empty entry', entry.key);
            return callback(null, Readable.from([]));
          }
          callback(error, Readable.from([]));
        },
      );
    });
  }

  /*
   * yazl reports a failed entry by emitting on the ZipFile, not on the output stream — so without
   * this an object store having a bad minute takes the whole process down with an unhandled 'error'.
   * The response has already begun by then, so the only honest end is a truncated body: the client
   * sees a broken download rather than a silently incomplete archive it might trust.
   */
  zip.on('error', (error: Error) => {
    console.error('[export] archive failed mid-stream', error);
    (zip.outputStream as unknown as Readable).destroy(error);
  });

  zip.end();

  const stamp = exportedAt.slice(0, 10);
  return { stream: zip.outputStream as unknown as Readable, filename: `timeline-${stamp}.zip` };
}
