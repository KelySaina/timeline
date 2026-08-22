/**
 * "Vero added a memory" — a notification when the other person writes something.
 *
 * This rides the change bus rather than the scheduler, because it is not about a date: it should
 * arrive within seconds of the write, the way the on-screen update already does. Two consequences
 * worth stating.
 *
 * **Every replica hears every change**, so a listener registered here runs once per replica. The
 * send is therefore claimed first, exactly as the reminder tick claims its own — the primary key
 * decides who delivers. Filtering by couple would not help; it is the same change everywhere.
 *
 * **It reads the row.** The bus deliberately carries a nudge and not content, so that every client
 * re-reads through an authorized endpoint and the couple check stays on the read path. That reason
 * does not apply here: this code runs inside the server with no client to authorize, and a
 * notification saying "a memory was added" without saying which one is not worth interrupting
 * someone for. So the title is fetched, scoped to the couple the change named.
 *
 * Off by default. This is the frequent kind, and the frequent kind is what makes someone revoke
 * permission for the other two.
 */
import { queryOne, query } from '../../db/pool.js';
import { subscribeAll, type Change } from '../realtime/bus.js';
import { pushConfigured } from '../../config/env.js';
import { claim, releaseClaim, sendToUser } from './push.service.js';
import type { Deliver } from './reminders.js';

/** Who should hear about a change, and what to call the person who made it. */
type Recipient = { user_id: string; actor_name: string };

async function recipients(coupleId: string, actorId: string | undefined): Promise<Recipient[]> {
  return query<Recipient>(
    `select m.user_id,
            coalesce(actor.display_name, 'Someone') as actor_name
       from couple_members m
       left join users actor on actor.id = $2
      where m.couple_id = $1
        and m.left_at is null
        -- Never the person who did it. They watched it happen.
        and ($2::uuid is null or m.user_id <> $2)
        and (select notify_activity from users u where u.id = m.user_id)
        and exists (select 1 from push_subscriptions s where s.user_id = m.user_id)`,
    [coupleId, actorId ?? null],
  );
}

/** The event's own title, scoped to the couple the change claimed it belongs to. */
async function eventTitle(coupleId: string, eventId: string): Promise<string | null> {
  const row = await queryOne<{ title: string }>(
    'select title from events where id = $1 and couple_id = $2 and deleted_at is null',
    [eventId, coupleId],
  );
  return row?.title ?? null;
}

const truncate = (value: string, max = 48): string =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

/**
 * Turn a change into something worth reading, or into null when it is not.
 *
 * Only two kinds qualify. An edit, a deletion or a theme change is not news — it is housekeeping the
 * other screen has already applied silently, and a notification for it would be the kind of noise
 * that gets notifications turned off.
 */
async function describe(
  change: Change,
  actorName: string,
): Promise<{ title: string; body: string; url: string; tag: string } | null> {
  if (change.kind === 'member.joined') {
    return {
      title: `${actorName} joined your timeline`,
      body: 'Two of you now.',
      url: '/us',
      tag: `joined:${change.actor ?? change.couple}`,
    };
  }

  if (change.kind !== 'event.created' || !change.id) return null;

  const title = await eventTitle(change.couple, change.id);
  // Gone between the write and this read — deleted immediately, or the id was not theirs after all.
  if (!title) return null;

  return {
    title: `${actorName} added a memory`,
    body: truncate(title),
    // Straight to the memory itself rather than the timeline: this notification is about one thing.
    url: `/memory/${change.id}`,
    tag: `event:${change.id}`,
  };
}

/**
 * `deliver` is a parameter for the same reason the reminder tick has one: the claim is *released*
 * when nothing accepts a notification, so a test that watched the claim table would find it empty
 * whether the send was skipped or merely undeliverable. What matters is who was told.
 */
async function handle(change: Change, deliver: Deliver = sendToUser): Promise<void> {
  const people = await recipients(change.couple, change.actor);
  if (people.length === 0) return;

  // Built once: the wording depends on the change and on who made it, not on who is reading it.
  const payload = await describe(change, people[0]!.actor_name);
  if (!payload) return;

  for (const person of people) {
    // Claimed per recipient, so two partners are two separate sends rather than one race.
    const key = `activity:${payload.tag}`;
    // Already claimed means already sent. The same memory must not interrupt someone twice — and
    // because a failed delivery gives its claim back, a genuine retry is still possible.
    // Already claimed means already sent. The same memory must not interrupt someone twice — and
    // because a failed delivery gives its claim back, a genuine retry is still possible.
    if (!(await claim(person.user_id, key))) continue;

    const delivered = await deliver(person.user_id, payload);
    // Nothing took it. Release, so a retry is possible — unlike a reminder there is no later tick
    // to retry from, but a repeat of the same change (a restore, say) should not be swallowed.
    if (delivered === 0) await releaseClaim(person.user_id, key);
  }
}

let unsubscribe: (() => void) | null = null;

export function startActivityPush(): void {
  if (!pushConfigured || unsubscribe) return;
  unsubscribe = subscribeAll((change) => {
    // Never let a notification failure escape into the write that caused it. The bus listener runs
    // detached from any request, so an unhandled rejection here would take the process down.
    void handle(change).catch((error) => console.error('[push] activity notification failed', error));
  });
}

export function stopActivityPush(): void {
  unsubscribe?.();
  unsubscribe = null;
}

/** Exported for the tests, which drive one change through without a live bus. */
export const handleChangeForTests = handle;
