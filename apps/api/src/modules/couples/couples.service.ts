import type { PoolClient } from 'pg';
import { query, queryOne, transaction } from '../../db/pool.js';
import { conflict, notFound } from '../../lib/errors.js';
import { elapsed } from '../../lib/dates.js';
import { inviteCode } from '../../lib/token.js';

const INVITE_TTL_DAYS = 14;

export type Member = {
  id: string;
  displayName: string;
  birthday: string | null;
  hasAvatar: boolean;
  role: 'owner' | 'partner';
  joinedAt: string;
};

export type CoupleSnapshot = {
  id: string;
  title: string | null;
  startedOn: string | null;
  theme: string;
  storyLayout: string;
  role: 'owner' | 'partner';
  members: Member[];
  together: ReturnType<typeof elapsed> | null;
  stats: { memories: number; trips: number; milestones: number; photos: number; upcoming: number };
};

/**
 * Derived yearly dates (the anniversary, each partner's birthday) are rebuilt from their source
 * rather than edited in place, so they can never drift out of sync with the profile they mirror.
 */
export async function syncDerivedRecurring(client: PoolClient, coupleId: string): Promise<void> {
  const couple = await client.query<{ started_on: string | null; title: string | null; created_by: string }>(
    'select started_on, title, created_by from couples where id = $1',
    [coupleId],
  );
  const row = couple.rows[0];
  if (!row) return;

  /*
   * Rebuilding these rows must not throw away the one field on them that is not derived. How far
   * ahead a reminder arrives is the couple's setting, and a profile save — changing a nickname,
   * adding a birthday — would otherwise silently reset every lead time to the default.
   */
  const kept = await client.query<{ source: string; source_user_id: string | null; remind_days_before: number }>(
    "select source, source_user_id, remind_days_before from recurring_events where couple_id = $1 and source <> 'custom'",
    [coupleId],
  );
  // Matches recurring_events.remind_days_before's own default in 001; only ever used the first
  // time a derived row is created, when there is no previous setting to carry over.
  const DEFAULT_REMIND_DAYS = 7;
  const leadTime = (source: string, userId: string | null): number =>
    kept.rows.find((row) => row.source === source && row.source_user_id === userId)?.remind_days_before ??
    DEFAULT_REMIND_DAYS;

  await client.query("delete from recurring_events where couple_id = $1 and source <> 'custom'", [coupleId]);

  if (row.started_on) {
    const [year, month, day] = row.started_on.split('-').map(Number);
    await client.query(
      `insert into recurring_events
         (couple_id, kind, title, month, day, start_year, source, created_by, remind_days_before)
       values ($1, 'anniversary', $2, $3, $4, $5, 'couple_anniversary', $6,
               $7)`,
      [coupleId, 'Our anniversary', month, day, year, row.created_by, leadTime('couple_anniversary', null)],
    );
  }

  const members = await client.query<{ user_id: string; display_name: string; birthday: string | null }>(
    `select m.user_id, u.display_name, u.birthday
       from couple_members m join users u on u.id = m.user_id
      where m.couple_id = $1 and m.left_at is null`,
    [coupleId],
  );

  for (const member of members.rows) {
    if (!member.birthday) continue;
    const [, month, day] = member.birthday.split('-').map(Number);
    await client.query(
      `insert into recurring_events
         (couple_id, kind, title, month, day, start_year, source, source_user_id, created_by,
          remind_days_before)
       values ($1, 'birthday', $2, $3, $4, $5, 'member_birthday', $6, $6,
               $7)`,
      [
        coupleId,
        `${member.display_name}'s birthday`,
        month,
        day,
        Number(member.birthday.split('-')[0]),
        member.user_id,
        leadTime('member_birthday', member.user_id),
      ],
    );
  }
}

export async function createCouple(
  userId: string,
  input: { title?: string | null; startedOn?: string | null },
): Promise<string> {
  const active = await queryOne<{ couple_id: string }>(
    'select couple_id from couple_members where user_id = $1 and left_at is null',
    [userId],
  );
  if (active) throw conflict('You are already in a relationship on Timeline', 'already_coupled');

  return transaction(async (client) => {
    const created = await client.query<{ id: string }>(
      `insert into couples (title, started_on, created_by) values ($1, $2, $3) returning id`,
      [input.title?.trim() || null, input.startedOn ?? null, userId],
    );
    const coupleId = created.rows[0]!.id;
    await client.query(
      `insert into couple_members (couple_id, user_id, role) values ($1, $2, 'owner')`,
      [coupleId, userId],
    );
    await syncDerivedRecurring(client, coupleId);
    return coupleId;
  });
}

export async function updateCouple(
  coupleId: string,
  patch: { title?: string | null; startedOn?: string | null; theme?: string; storyLayout?: string },
): Promise<void> {
  await transaction(async (client) => {
    await client.query(
      `update couples
          set title      = case when $2::boolean then $3::text else title end,
              started_on = case when $4::boolean then $5::date else started_on end,
              theme      = coalesce($6, theme),
              story_layout = coalesce($7, story_layout),
              updated_at = now()
        where id = $1`,
      [
        coupleId,
        patch.title !== undefined,
        patch.title ?? null,
        patch.startedOn !== undefined,
        patch.startedOn ?? null,
        patch.theme ?? null,
        patch.storyLayout ?? null,
      ],
    );
    await syncDerivedRecurring(client, coupleId);
  });
}

/** Rebuild derived rows after a member edits their own birthday. */
export async function refreshDerivedForUser(userId: string): Promise<void> {
  const active = await queryOne<{ couple_id: string }>(
    'select couple_id from couple_members where user_id = $1 and left_at is null',
    [userId],
  );
  if (!active) return;
  await transaction((client) => syncDerivedRecurring(client, active.couple_id));
}

export async function getCoupleSnapshot(userId: string): Promise<CoupleSnapshot | null> {
  const couple = await queryOne<{
    id: string;
    title: string | null;
    started_on: string | null;
    theme: string;
    story_layout: string;
    role: 'owner' | 'partner';
  }>(
    `select c.id, c.title, c.started_on, c.theme, c.story_layout, m.role
       from couple_members m join couples c on c.id = m.couple_id
      where m.user_id = $1 and m.left_at is null`,
    [userId],
  );
  if (!couple) return null;

  const [members, stats] = await Promise.all([
    query<{
      id: string;
      display_name: string;
      birthday: string | null;
      avatar_key: string | null;
      role: 'owner' | 'partner';
      joined_at: string;
    }>(
      `select u.id, u.display_name, u.birthday, u.avatar_key, m.role, m.joined_at
         from couple_members m join users u on u.id = m.user_id
        where m.couple_id = $1 and m.left_at is null
        order by m.joined_at`,
      [couple.id],
    ),
    queryOne<{
      memories: string;
      trips: string;
      milestones: string;
      photos: string;
      upcoming: string;
    }>(
      `select
         count(*) filter (where e.event_date <= current_date)                        as memories,
         count(*) filter (where e.type = 'trip')                                     as trips,
         count(*) filter (where e.type in ('milestone', 'life'))                     as milestones,
         (select count(*) from event_photos p where p.couple_id = $1)                as photos,
         count(*) filter (where e.event_date > current_date)                         as upcoming
       from events e
      where e.couple_id = $1 and e.deleted_at is null`,
      [couple.id],
    ),
  ]);

  return {
    id: couple.id,
    title: couple.title,
    startedOn: couple.started_on,
    theme: couple.theme,
    storyLayout: couple.story_layout,
    role: couple.role,
    members: members.map((m) => ({
      id: m.id,
      displayName: m.display_name,
      birthday: m.birthday,
      hasAvatar: Boolean(m.avatar_key),
      role: m.role,
      joinedAt: m.joined_at,
    })),
    together: couple.started_on ? elapsed(couple.started_on) : null,
    stats: {
      memories: Number(stats?.memories ?? 0),
      trips: Number(stats?.trips ?? 0),
      milestones: Number(stats?.milestones ?? 0),
      photos: Number(stats?.photos ?? 0),
      upcoming: Number(stats?.upcoming ?? 0),
    },
  };
}

export type Invitation = { id: string; code: string; expiresAt: string; createdAt: string };

export async function createInvitation(coupleId: string, userId: string): Promise<Invitation> {
  const memberCount = await queryOne<{ count: string }>(
    'select count(*) as count from couple_members where couple_id = $1 and left_at is null',
    [coupleId],
  );
  if (Number(memberCount?.count ?? 0) >= 2) {
    throw conflict('Your relationship already has both of you in it', 'couple_full');
  }

  // One live invite at a time: a fresh link quietly retires the previous one.
  await query(
    `update invitations set revoked_at = now()
      where couple_id = $1 and accepted_at is null and revoked_at is null`,
    [coupleId],
  );

  const rows = await query<{ id: string; code: string; expires_at: string; created_at: string }>(
    `insert into invitations (couple_id, code, created_by, expires_at)
     values ($1, $2, $3, now() + ($4 || ' days')::interval)
     returning id, code, expires_at, created_at`,
    [coupleId, inviteCode(), userId, INVITE_TTL_DAYS],
  );
  const row = rows[0]!;
  return { id: row.id, code: row.code, expiresAt: row.expires_at, createdAt: row.created_at };
}

export async function activeInvitation(coupleId: string): Promise<Invitation | null> {
  const row = await queryOne<{ id: string; code: string; expires_at: string; created_at: string }>(
    `select id, code, expires_at, created_at
       from invitations
      where couple_id = $1 and accepted_at is null and revoked_at is null and expires_at > now()
      order by created_at desc limit 1`,
    [coupleId],
  );
  return row ? { id: row.id, code: row.code, expiresAt: row.expires_at, createdAt: row.created_at } : null;
}

export async function revokeInvitations(coupleId: string): Promise<void> {
  await query(
    `update invitations set revoked_at = now()
      where couple_id = $1 and accepted_at is null and revoked_at is null`,
    [coupleId],
  );
}

export type InvitePreview = { code: string; coupleTitle: string | null; invitedBy: string; startedOn: string | null };

export async function previewInvitation(code: string): Promise<InvitePreview> {
  const row = await queryOne<{
    code: string;
    title: string | null;
    started_on: string | null;
    display_name: string;
  }>(
    `select i.code, c.title, c.started_on, u.display_name
       from invitations i
       join couples c on c.id = i.couple_id
       join users u on u.id = i.created_by
      where upper(i.code) = upper($1)
        and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()`,
    [code],
  );
  if (!row) throw notFound('That invitation is no longer valid');
  return {
    code: row.code,
    coupleTitle: row.title,
    invitedBy: row.display_name,
    startedOn: row.started_on,
  };
}

export async function acceptInvitation(code: string, userId: string): Promise<string> {
  const active = await queryOne<{ couple_id: string }>(
    'select couple_id from couple_members where user_id = $1 and left_at is null',
    [userId],
  );
  if (active) throw conflict('You are already in a relationship on Timeline', 'already_coupled');

  return transaction(async (client) => {
    // Locking the invitation row makes "two people redeem the same code" a losing race for one of them.
    const invite = await client.query<{ id: string; couple_id: string }>(
      `select id, couple_id from invitations
        where upper(code) = upper($1)
          and accepted_at is null and revoked_at is null and expires_at > now()
        for update`,
      [code],
    );
    const row = invite.rows[0];
    if (!row) throw notFound('That invitation is no longer valid');

    const seats = await client.query<{ count: string }>(
      'select count(*) as count from couple_members where couple_id = $1 and left_at is null',
      [row.couple_id],
    );
    if (Number(seats.rows[0]?.count ?? 0) >= 2) throw conflict('That relationship is already complete', 'couple_full');

    await client.query(
      `insert into couple_members (couple_id, user_id, role) values ($1, $2, 'partner')`,
      [row.couple_id, userId],
    );
    await client.query(
      'update invitations set accepted_at = now(), accepted_by = $2 where id = $1',
      [row.id, userId],
    );
    await syncDerivedRecurring(client, row.couple_id);
    return row.couple_id;
  });
}
