/**
 * The scheduler that finally makes `recurring_events.remind_days_before` mean something.
 *
 * Three things decide this design.
 *
 * **It runs in every replica, and that is fine.** There is no leader election and no advisory
 * lock, because the claim is a row: every send is `insert into notification_sends ... on conflict do
 * nothing` before it is attempted, so two replicas ticking in the same second produce one send and
 * one no-op. The primary key is the concurrency control. A redeploy mid-tick is the same story.
 *
 * **It fires at a local hour, not at a UTC instant.** "Seven days before" is a sentence about a
 * calendar, so the whole comparison happens in the recipient's own date: their local date is what
 * `daysUntil` counts from, and the tick only acts on people for whom it is currently the send
 * hour. That is also why a tick every quarter hour is enough — it only has to land inside the hour
 * once, and the claim row makes the other three no-ops.
 *
 * **A missed reminder is not an incident.** Nothing retries across hours, nothing queues, nothing
 * escalates. Web push offers no delivery guarantee to build on, and the app itself is still the
 * truth: Upcoming has always shown these dates whether or not a notification arrived.
 */
import { daysUntil, nextOccurrence } from '../../lib/dates.js';
import { query } from '../../db/pool.js';
import { pushConfigured } from '../../config/env.js';
import { claim, releaseClaim, sendToUser, type PushPayload } from './push.service.js';

/** How a reminder reaches a person. A parameter so the tests can assert on selection without a
 *  push service, and so the send path stays swappable if delivery ever moves off web push. */
export type Deliver = (userId: string, payload: PushPayload) => Promise<number>;

/** Local hour at which reminders go out. Early enough to act on, late enough to be awake for. */
export const SEND_HOUR = 9;

/**
 * Every 15 minutes. The send hour is an hour wide, so any interval under an hour lands in it; the
 * margin is for a replica that was restarting on the exact minute.
 */
const TICK_MS = 15 * 60 * 1000;

type Candidate = {
  user_id: string;
  couple_id: string;
  local_date: string;
};

type Due = {
  id: string;
  kind: 'anniversary' | 'birthday' | 'custom';
  title: string;
  month: number;
  day: number;
  start_year: number | null;
  source: string;
  source_user_id: string | null;
  remind_days_before: number;
};

const ordinal = (n: number): string => {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

const when = (days: number): string =>
  days === 0 ? 'is today' : days === 1 ? 'is tomorrow' : `is in ${days} days`;

/**
 * Everyone for whom it is currently the send hour, has somewhere to send to, and has a
 * relationship whose dates there is anything to remind them about.
 *
 * The local date and hour are computed by Postgres from the stored IANA name rather than in JS,
 * so one clock decides — and DST is the database's problem, which it is good at.
 */
async function candidates(pref: 'notify_reminders' | 'notify_on_this_day'): Promise<Candidate[]> {
  // `pref` is one of two literals from this module, never anything a request supplied.
  return query<Candidate>(
    `select u.id as user_id,
            cm.couple_id,
            (now() at time zone u.timezone)::date::text as local_date
       from users u
       join couple_members cm on cm.user_id = u.id and cm.left_at is null
      where extract(hour from now() at time zone u.timezone) = $1
        and u.${pref}
        and exists (select 1 from push_subscriptions s where s.user_id = u.id)`,
    [SEND_HOUR],
  );
}

function message(row: Due, occurrence: string, days: number): { title: string; body: string } {
  const distance = when(days);
  if (row.kind === 'anniversary' && row.start_year) {
    // Counted from the occurrence being reminded about, not from today: on 29 December, "your 6th"
    // and "your 7th" are a couple of days apart.
    const years = Number(occurrence.slice(0, 4)) - row.start_year;
    return { title: `Your ${ordinal(years)} anniversary ${distance}`, body: 'Worth planning something.' };
  }
  return { title: `${row.title} ${distance}`, body: 'From your timeline.' };
}

/**
 * One pass. Exported for the tests, which drive it directly rather than waiting on a timer.
 * Returns how many reminders were claimed, so a caller can assert on it.
 */
export async function runReminderTick(deliver: Deliver = sendToUser): Promise<number> {
  const people = await candidates('notify_reminders');
  if (people.length === 0) return 0;

  let claimed = 0;

  for (const person of people) {
    const rows = await query<Due>(
      `select id, kind, title, month, day, start_year, source, source_user_id, remind_days_before
         from recurring_events where couple_id = $1`,
      [person.couple_id],
    );

    for (const row of rows) {
      const date = nextOccurrence(row.month, row.day, person.local_date);
      if (daysUntil(date, person.local_date) !== row.remind_days_before) continue;

      // Nobody needs a week's warning about their own birthday. The partner still gets theirs.
      if (row.source === 'member_birthday' && row.source_user_id === person.user_id) continue;

      // Claim before sending. The key names the occurrence, not the row, so the same anniversary
      // is claimable again next year — and an id-only key would silently never fire twice.
      const key = `recurring:${row.id}:${date}`;
      if (!(await claim(person.user_id, key))) continue;
      claimed += 1;

      const { title, body } = message(row, date, row.remind_days_before);
      const delivered = await deliver(person.user_id, {
        title,
        body,
        url: '/upcoming',
        // Collapse on the occurrence: a device that comes back online after several attempts shows
        // one notification, not one per attempt.
        tag: `recurring:${row.id}:${date}`,
      });

      // Nothing accepted it — release the claim so a later tick in this same hour can try again.
      // Once the hour passes the reminder is simply missed, which is the honest outcome.
      if (delivered === 0) {
        await releaseClaim(person.user_id, key);
        claimed -= 1;
      }
    }
  }

  return claimed;
}

/* ---------------------------------------------------------------------------------------------
 * On this day
 * ------------------------------------------------------------------------------------------ */

type Anniversary = { id: string; title: string; event_date: string; years: number };

/**
 * "Three years ago today." Runs on the same tick and the same local hour as reminders, because it
 * answers the same question — what does today mean — from the other direction: reminders look
 * forward at dates that recur, this looks back at ones that happened.
 *
 * Matched on month and day rather than by computing dates in JS, so 29 February simply has no match
 * in a common year. That is the honest answer: the memory happened on a date that does not exist
 * this year, and inventing the 28th for it would be inventing precision the schema refuses to.
 */
export async function runOnThisDayTick(deliver: Deliver = sendToUser): Promise<number> {
  const people = await candidates('notify_on_this_day');
  if (people.length === 0) return 0;

  let sent = 0;

  for (const person of people) {
    const rows = await query<Anniversary>(
      `select e.id, e.title, e.event_date::text as event_date,
              (extract(year from $2::date) - extract(year from e.event_date))::int as years
         from events e
        where e.couple_id = $1
          and e.deleted_at is null
          and extract(month from e.event_date) = extract(month from $2::date)
          and extract(day from e.event_date) = extract(day from $2::date)
          and e.event_date < $2::date
          -- A memory recorded to the month or the year did not happen on a day, so it has no
          -- anniversary to mark.
          and e.date_precision = 'day'
        order by e.event_date`,
      [person.couple_id, person.local_date],
    );
    if (rows.length === 0) continue;

    // One notification a day at most, whatever it holds. Two would be two interruptions for the
    // same thought.
    const key = `onthisday:${person.local_date}`;
    if (!(await claim(person.user_id, key))) continue;

    const oldest = rows[0]!;
    const years = oldest.years === 1 ? 'A year ago today' : `${oldest.years} years ago today`;
    const title = rows.length === 1 ? years : `${years}, and ${rows.length - 1} more`;

    const delivered = await deliver(person.user_id, {
      title,
      body: rows.map((row) => row.title).slice(0, 3).join(' · '),
      // The whole day, not one memory: there may be several, and they are the point together.
      url: rows.length === 1 ? `/memory/${oldest.id}` : '/',
      tag: key,
    });

    if (delivered === 0) await releaseClaim(person.user_id, key);
    else sent += 1;
  }

  return sent;
}

let timer: NodeJS.Timeout | null = null;

export function startReminders(): void {
  if (!pushConfigured || timer) return;
  timer = setInterval(() => {
    void runReminderTick().catch((error) => console.error('[reminders] tick failed', error));
    void runOnThisDayTick().catch((error) => console.error('[on-this-day] tick failed', error));
  }, TICK_MS);
  // Never hold the process open: a tick pending at shutdown is a tick worth losing.
  timer.unref();
}

export function stopReminders(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
