import type { PoolClient } from 'pg';
import { query, queryOne, transaction } from '../../db/pool.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { MAX_PHOTOS_PER_EVENT, storeEventPhoto } from '../photos/photos.service.js';
import { removeObject } from '../photos/storage/index.js';
import type { DatePrecision, EventType, Mood, TimelineEvent } from './events.types.js';

type Row = {
  id: string;
  type: EventType;
  title: string;
  description: string | null;
  event_date: string;
  end_date: string | null;
  date_precision: DatePrecision;
  location: string | null;
  mood: Mood | null;
  created_at: string;
  updated_at: string;
  author_id: string;
  author_name: string;
  photos: TimelineEvent['photos'];
  tags: string[];
};

const SELECT = `
  select e.id, e.type, e.title, e.description, e.event_date, e.end_date, e.date_precision,
         e.location, e.mood, e.created_at, e.updated_at,
         u.id as author_id, u.display_name as author_name,
         coalesce((
           select json_agg(json_build_object('id', p.id, 'width', p.width, 'height', p.height,
                                             'position', p.position)
                           order by p.position, p.created_at)
             from event_photos p where p.event_id = e.id
         ), '[]'::json) as photos,
         coalesce((
           select json_agg(t.tag order by t.tag) from event_tags t where t.event_id = e.id
         ), '[]'::json) as tags
    from events e
    join users u on u.id = e.created_by`;

const toEvent = (row: Row): TimelineEvent => ({
  id: row.id,
  type: row.type,
  title: row.title,
  description: row.description,
  eventDate: row.event_date,
  endDate: row.end_date,
  datePrecision: row.date_precision,
  location: row.location,
  mood: row.mood,
  tags: row.tags ?? [],
  photos: row.photos ?? [],
  author: { id: row.author_id, displayName: row.author_name },
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export type ListFilters = {
  scope: 'past' | 'upcoming' | 'all';
  order: 'asc' | 'desc';
  types?: EventType[];
  year?: number;
  q?: string;
  limit: number;
  offset: number;
};

export async function listEvents(
  coupleId: string,
  filters: ListFilters,
): Promise<{ events: TimelineEvent[]; total: number }> {
  const where: string[] = ['e.couple_id = $1', 'e.deleted_at is null'];
  const params: unknown[] = [coupleId];

  // Past vs upcoming is decided by event_date against the server's date, never by created_at.
  if (filters.scope === 'past') where.push('e.event_date <= current_date');
  if (filters.scope === 'upcoming') where.push('e.event_date > current_date');

  if (filters.types?.length) {
    params.push(filters.types);
    where.push(`e.type = any($${params.length}::text[])`);
  }
  if (filters.year) {
    params.push(filters.year);
    where.push(`extract(year from e.event_date) = $${params.length}`);
  }
  if (filters.q) {
    /*
     * Every word has to appear somewhere, in any of the fields — so "paris train" finds a memory
     * called "The train" that happened in Paris. One substring across the whole query could not:
     * it looked for the literal phrase "paris train" and found nothing, which is the shape of a
     * search box people give up on.
     *
     * Accents are folded on both sides. 'Antsirabe' and 'Antsirabé' are the same place and neither
     * spelling used to find the other.
     *
     * Capped at eight words. Beyond that the query is not a search any more, and each term costs a
     * scan of the tag table.
     */
    for (const term of filters.q.split(/\s+/).filter(Boolean).slice(0, 8)) {
      params.push(`%${term}%`);
      const p = `unaccent($${params.length})`;
      where.push(`(
        unaccent(e.title) ilike ${p}
        or unaccent(e.description) ilike ${p}
        or unaccent(e.location) ilike ${p}
        or exists (
          select 1 from event_tags t where t.event_id = e.id and unaccent(t.tag) ilike ${p}
        )
      )`);
    }
  }

  const clause = where.join(' and ');
  const direction = filters.order === 'asc' ? 'asc' : 'desc';
  params.push(filters.limit, filters.offset);

  const [rows, count] = await Promise.all([
    query<Row>(
      `${SELECT} where ${clause}
        order by e.event_date ${direction}, e.created_at ${direction}
        limit $${params.length - 1} offset $${params.length}`,
      params,
    ),
    queryOne<{ total: string }>(
      `select count(*) as total from events e where ${clause}`,
      params.slice(0, params.length - 2),
    ),
  ]);

  return { events: rows.map(toEvent), total: Number(count?.total ?? 0) };
}

export async function getEvent(coupleId: string, eventId: string): Promise<TimelineEvent> {
  const row = await queryOne<Row>(
    `${SELECT} where e.id = $2 and e.couple_id = $1 and e.deleted_at is null`,
    [coupleId, eventId],
  );
  if (!row) throw notFound('That memory is not in your timeline');
  return toEvent(row);
}

/** Year buckets and per-type counts — enough to build the filter bar without loading the timeline. */
export async function getSummary(coupleId: string) {
  const [years, types, bounds] = await Promise.all([
    query<{ year: number; count: string }>(
      `select extract(year from event_date)::int as year, count(*) as count
         from events
        where couple_id = $1 and deleted_at is null and event_date <= current_date
        group by 1 order by 1 desc`,
      [coupleId],
    ),
    query<{ type: EventType; count: string }>(
      // Past-only, exactly like the year counts above. These two drive the chips that sit side by
      // side over the story scroll, so counting future memories here made a "Trips 3" chip filter
      // down to two rows — and made the type chips disagree with the year chips in the same row.
      `select type, count(*) as count
         from events
        where couple_id = $1 and deleted_at is null and event_date <= current_date
        group by 1`,
      [coupleId],
    ),
    queryOne<{ first_date: string | null; last_date: string | null; upcoming: string }>(
      `select min(event_date) filter (where event_date <= current_date) as first_date,
              max(event_date) filter (where event_date <= current_date) as last_date,
              count(*) filter (where event_date > current_date)         as upcoming
         from events where couple_id = $1 and deleted_at is null`,
      [coupleId],
    ),
  ]);

  return {
    years: years.map((y) => ({ year: y.year, count: Number(y.count) })),
    types: Object.fromEntries(types.map((t) => [t.type, Number(t.count)])) as Record<EventType, number>,
    firstDate: bounds?.first_date ?? null,
    lastDate: bounds?.last_date ?? null,
    upcomingCount: Number(bounds?.upcoming ?? 0),
  };
}

export type EventInput = {
  type: EventType;
  title: string;
  description?: string | null;
  eventDate: string;
  endDate?: string | null;
  datePrecision?: DatePrecision;
  location?: string | null;
  mood?: Mood | null;
  tags?: string[];
};

const normalizeTags = (tags: string[] | undefined) =>
  [...new Set((tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 12);

async function replaceTags(client: PoolClient, coupleId: string, eventId: string, tags: string[]) {
  await client.query('delete from event_tags where event_id = $1', [eventId]);
  for (const tag of tags) {
    await client.query(
      'insert into event_tags (event_id, couple_id, tag) values ($1, $2, $3) on conflict do nothing',
      [eventId, coupleId, tag],
    );
  }
}

export async function createEvent(
  coupleId: string,
  userId: string,
  input: EventInput,
): Promise<TimelineEvent> {
  const id = await transaction(async (client) => {
    const created = await client.query<{ id: string }>(
      `insert into events
         (couple_id, created_by, type, title, description, event_date, end_date,
          date_precision, location, mood)
       values ($1, $2, $3, $4, $5, $6, $7, coalesce($8, 'day'), $9, $10)
       returning id`,
      [
        coupleId,
        userId,
        input.type,
        input.title.trim(),
        input.description?.trim() || null,
        input.eventDate,
        input.endDate ?? null,
        input.datePrecision ?? null,
        input.location?.trim() || null,
        input.mood ?? null,
      ],
    );
    const eventId = created.rows[0]!.id;
    await replaceTags(client, coupleId, eventId, normalizeTags(input.tags));
    return eventId;
  });
  return getEvent(coupleId, id);
}

export async function updateEvent(
  coupleId: string,
  eventId: string,
  patch: Partial<EventInput>,
): Promise<TimelineEvent> {
  await getEvent(coupleId, eventId); // authorization + existence, before any write
  await transaction(async (client) => {
    await client.query(
      `update events
          set type           = coalesce($3, type),
              title          = coalesce($4, title),
              description    = case when $5::boolean then $6::text else description end,
              event_date     = coalesce($7::date, event_date),
              end_date       = case when $8::boolean then $9::date else end_date end,
              date_precision = coalesce($10, date_precision),
              location       = case when $11::boolean then $12::text else location end,
              mood           = case when $13::boolean then $14::text else mood end,
              updated_at     = now()
        where id = $2 and couple_id = $1`,
      [
        coupleId,
        eventId,
        patch.type ?? null,
        patch.title?.trim() ?? null,
        patch.description !== undefined,
        patch.description?.trim() ?? null,
        patch.eventDate ?? null,
        patch.endDate !== undefined,
        patch.endDate ?? null,
        patch.datePrecision ?? null,
        patch.location !== undefined,
        patch.location?.trim() ?? null,
        patch.mood !== undefined,
        patch.mood ?? null,
      ],
    );
    if (patch.tags !== undefined) await replaceTags(client, coupleId, eventId, normalizeTags(patch.tags));
  });
  return getEvent(coupleId, eventId);
}

export async function softDeleteEvent(coupleId: string, eventId: string): Promise<void> {
  const rows = await query<{ id: string }>(
    `update events set deleted_at = now(), updated_at = now()
      where id = $2 and couple_id = $1 and deleted_at is null returning id`,
    [coupleId, eventId],
  );
  if (rows.length === 0) throw notFound('That memory is not in your timeline');
}

/**
 * Undo a delete. Nothing here is recovered from a backup: the row never left, its photos never
 * left, and clearing `deleted_at` is the whole operation.
 *
 * Deliberately not time-boxed. A window would have to be either generous enough to be pointless as
 * a safeguard or short enough to fail on a slow phone, and there is nothing to protect against —
 * the row belongs to this couple, they are the only ones who can name its id, and nothing purges
 * it. The undo affordance is what expires, not the ability to restore.
 */
export async function restoreEvent(coupleId: string, eventId: string): Promise<TimelineEvent> {
  await query(
    `update events set deleted_at = null, updated_at = now()
      where id = $2 and couple_id = $1 and deleted_at is not null`,
    [coupleId, eventId],
  );
  // Updating no row is not a failure: it means the memory is already back — two taps of Undo, or
  // both partners undoing the same delete. getEvent supplies the 404 for an id that was never
  // theirs, which is the only case that should fail, and it applies the couple check on the read
  // path exactly as every other read does.
  return getEvent(coupleId, eventId);
}

export async function addPhotos(
  coupleId: string,
  userId: string,
  eventId: string,
  files: Express.Multer.File[],
): Promise<TimelineEvent> {
  if (files.length === 0) throw badRequest('Pick at least one photo');
  await getEvent(coupleId, eventId);

  const existing = await queryOne<{ count: string; next: number | null }>(
    'select count(*) as count, max(position) as next from event_photos where event_id = $1',
    [eventId],
  );
  const already = Number(existing?.count ?? 0);
  if (already + files.length > MAX_PHOTOS_PER_EVENT) {
    throw badRequest(`A memory holds up to ${MAX_PHOTOS_PER_EVENT} photos (this one has ${already})`);
  }

  let position = (existing?.next ?? -1) + 1;
  const stored = [];
  try {
    for (const file of files) {
      const photo = await storeEventPhoto(coupleId, file);
      stored.push(photo);
      await query(
        `insert into event_photos
           (id, event_id, couple_id, storage_key, thumb_key, width, height, byte_size, position, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          photo.id,
          eventId,
          coupleId,
          photo.storageKey,
          photo.thumbKey,
          photo.width,
          photo.height,
          photo.byteSize,
          position,
          userId,
        ],
      );
      position += 1;
    }
  } catch (error) {
    // Never leave orphan files behind when a batch fails halfway.
    await Promise.all(stored.flatMap((p) => [removeObject(p.storageKey), removeObject(p.thumbKey)]));
    await query('delete from event_photos where id = any($1::uuid[])', [stored.map((p) => p.id)]);
    throw error;
  }

  await query('update events set updated_at = now() where id = $1', [eventId]);
  return getEvent(coupleId, eventId);
}

export async function removePhoto(coupleId: string, eventId: string, photoId: string): Promise<TimelineEvent> {
  const row = await queryOne<{ storage_key: string; thumb_key: string }>(
    `delete from event_photos
      where id = $3 and event_id = $2 and couple_id = $1
      returning storage_key, thumb_key`,
    [coupleId, eventId, photoId],
  );
  if (!row) throw notFound('That photo is not in this memory');
  await Promise.all([removeObject(row.storage_key), removeObject(row.thumb_key)]);
  return getEvent(coupleId, eventId);
}

export async function reorderPhotos(coupleId: string, eventId: string, order: string[]): Promise<TimelineEvent> {
  await getEvent(coupleId, eventId);
  await transaction(async (client) => {
    for (const [index, photoId] of order.entries()) {
      await client.query(
        'update event_photos set position = $4 where id = $3 and event_id = $2 and couple_id = $1',
        [coupleId, eventId, photoId, index],
      );
    }
  });
  return getEvent(coupleId, eventId);
}
