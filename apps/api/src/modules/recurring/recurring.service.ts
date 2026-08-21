import { query, queryOne } from '../../db/pool.js';
import { daysUntil, nextOccurrence, todayIso } from '../../lib/dates.js';
import { forbidden, notFound } from '../../lib/errors.js';
import type { EventType } from '../events/events.types.js';

export type RecurringRow = {
  id: string;
  kind: 'anniversary' | 'birthday' | 'custom';
  title: string;
  month: number;
  day: number;
  start_year: number | null;
  source: 'couple_anniversary' | 'member_birthday' | 'custom';
  source_user_id: string | null;
  remind_days_before: number;
};

export type UpcomingItem = {
  key: string;
  kind: 'anniversary' | 'birthday' | 'custom' | 'plan';
  title: string;
  date: string;
  daysUntil: number;
  /** 3rd anniversary, 31st birthday — null when we do not know the origin year. */
  ordinal: number | null;
  recurring: boolean;
  eventId: string | null;
  eventType: EventType | null;
  location: string | null;
  photoCount: number;
  remindDaysBefore: number | null;
};

/**
 * Yearly dates are stored as (month, day) and resolved on read: no cron job to drift, no rows to
 * backfill, and leap-day birthdays land on Feb 28 in common years (see lib/dates).
 */
export async function listUpcoming(coupleId: string, horizonDays = 365): Promise<UpcomingItem[]> {
  const today = todayIso();

  const [recurring, plans] = await Promise.all([
    query<RecurringRow>(
      `select id, kind, title, month, day, start_year, source, source_user_id, remind_days_before
         from recurring_events where couple_id = $1`,
      [coupleId],
    ),
    query<{
      id: string;
      title: string;
      event_date: string;
      type: EventType;
      location: string | null;
      photo_count: string;
    }>(
      `select e.id, e.title, e.event_date, e.type, e.location,
              (select count(*) from event_photos p where p.event_id = e.id) as photo_count
         from events e
        where e.couple_id = $1 and e.deleted_at is null
          and e.event_date > current_date
          and e.event_date <= current_date + ($2 || ' days')::interval
        order by e.event_date`,
      [coupleId, horizonDays],
    ),
  ]);

  const items: UpcomingItem[] = [];

  for (const row of recurring) {
    const date = nextOccurrence(row.month, row.day, today);
    const distance = daysUntil(date, today);
    if (distance > horizonDays) continue;
    items.push({
      key: `recurring:${row.id}`,
      kind: row.kind,
      title: row.title,
      date,
      daysUntil: distance,
      ordinal: row.start_year ? Number(date.slice(0, 4)) - row.start_year : null,
      recurring: true,
      eventId: null,
      eventType: null,
      location: null,
      photoCount: 0,
      remindDaysBefore: row.remind_days_before,
    });
  }

  for (const plan of plans) {
    items.push({
      key: `event:${plan.id}`,
      kind: 'plan',
      title: plan.title,
      date: plan.event_date,
      daysUntil: daysUntil(plan.event_date, today),
      ordinal: null,
      recurring: false,
      eventId: plan.id,
      eventType: plan.type,
      location: plan.location,
      photoCount: Number(plan.photo_count),
      remindDaysBefore: null,
    });
  }

  return items.sort((a, b) => (a.date === b.date ? a.title.localeCompare(b.title) : a.date < b.date ? -1 : 1));
}

export async function createRecurring(
  coupleId: string,
  userId: string,
  input: { title: string; month: number; day: number; startYear?: number | null; remindDaysBefore?: number },
) {
  const rows = await query<{ id: string }>(
    `insert into recurring_events
       (couple_id, kind, title, month, day, start_year, source, remind_days_before, created_by)
     values ($1, 'custom', $2, $3, $4, $5, 'custom', coalesce($6, 7), $7)
     returning id`,
    [coupleId, input.title.trim(), input.month, input.day, input.startYear ?? null, input.remindDaysBefore ?? null, userId],
  );
  return rows[0]!.id;
}

/** Derived rows mirror a profile field; they are edited there, not here. */
async function assertCustom(coupleId: string, id: string): Promise<void> {
  const row = await queryOne<{ source: string }>(
    'select source from recurring_events where id = $1 and couple_id = $2',
    [id, coupleId],
  );
  if (!row) throw notFound('That reminder does not exist');
  if (row.source !== 'custom') {
    throw forbidden('Anniversaries and birthdays follow your profile — change them there');
  }
}

export async function updateRecurring(
  coupleId: string,
  id: string,
  patch: { title?: string; month?: number; day?: number; startYear?: number | null; remindDaysBefore?: number },
) {
  await assertCustom(coupleId, id);
  await query(
    `update recurring_events
        set title              = coalesce($3, title),
            month              = coalesce($4, month),
            day                = coalesce($5, day),
            start_year         = case when $6::boolean then $7::integer else start_year end,
            remind_days_before = coalesce($8, remind_days_before),
            updated_at         = now()
      where id = $2 and couple_id = $1`,
    [
      coupleId,
      id,
      patch.title?.trim() ?? null,
      patch.month ?? null,
      patch.day ?? null,
      patch.startYear !== undefined,
      patch.startYear ?? null,
      patch.remindDaysBefore ?? null,
    ],
  );
}

export async function deleteRecurring(coupleId: string, id: string): Promise<void> {
  await assertCustom(coupleId, id);
  await query('delete from recurring_events where id = $1 and couple_id = $2', [id, coupleId]);
}

export async function listRecurring(coupleId: string) {
  const rows = await query<RecurringRow>(
    `select id, kind, title, month, day, start_year, source, source_user_id, remind_days_before
       from recurring_events where couple_id = $1`,
    [coupleId],
  );
  // Ordered by what comes next, not by calendar month: sorting by (month, day) put a February
  // birthday at the top of the list in August, above everything actually approaching.
  return rows
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      month: row.month,
      day: row.day,
      startYear: row.start_year,
      source: row.source,
      editable: row.source === 'custom',
      remindDaysBefore: row.remind_days_before,
      nextDate: nextOccurrence(row.month, row.day),
    }))
    .sort((a, b) => (a.nextDate === b.nextDate ? a.title.localeCompare(b.title) : a.nextDate < b.nextDate ? -1 : 1));
}
