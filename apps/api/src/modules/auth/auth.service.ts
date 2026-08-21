import { query, queryOne } from '../../db/pool.js';
import { conflict, unauthorized } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import type { AuthUser } from '../../types.js';

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  birthday: string | null;
  avatar_key: string | null;
  token_version: number;
  password_hash: string;
};

const toAuthUser = (row: UserRow): AuthUser => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  birthday: row.birthday,
  avatarKey: row.avatar_key,
  tokenVersion: row.token_version,
});

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function signup(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<AuthUser> {
  const email = normalizeEmail(input.email);
  const existing = await queryOne<{ id: string }>('select id from users where email = $1', [email]);
  if (existing) throw conflict('That email already has an account', 'email_taken');

  const passwordHash = await hashPassword(input.password);
  const rows = await query<UserRow>(
    `insert into users (email, password_hash, display_name)
     values ($1, $2, $3)
     returning id, email, display_name, birthday, avatar_key, token_version, password_hash`,
    [email, passwordHash, input.displayName.trim()],
  );
  return toAuthUser(rows[0]!);
}

export async function login(input: { email: string; password: string }): Promise<AuthUser> {
  const row = await queryOne<UserRow>(
    `select id, email, display_name, birthday, avatar_key, token_version, password_hash
       from users where email = $1`,
    [normalizeEmail(input.email)],
  );
  // Same error either way, and the hash still runs on a miss so timing does not leak accounts.
  const ok = row
    ? await verifyPassword(input.password, row.password_hash)
    : await verifyPassword(input.password, 'scrypt$32768$8$1$AAAA$AAAA').then(() => false);
  if (!row || !ok) throw unauthorized('Email or password is incorrect');
  return toAuthUser(row);
}

export async function updateProfile(
  userId: string,
  patch: { displayName?: string; birthday?: string | null },
): Promise<AuthUser> {
  const rows = await query<UserRow>(
    `update users
        set display_name = coalesce($2, display_name),
            birthday     = case when $3::boolean then $4::date else birthday end,
            updated_at   = now()
      where id = $1
      returning id, email, display_name, birthday, avatar_key, token_version, password_hash`,
    [userId, patch.displayName ?? null, patch.birthday !== undefined, patch.birthday ?? null],
  );
  return toAuthUser(rows[0]!);
}

export async function setAvatarKey(userId: string, key: string): Promise<AuthUser> {
  const rows = await query<UserRow>(
    `update users set avatar_key = $2, updated_at = now() where id = $1
     returning id, email, display_name, birthday, avatar_key, token_version, password_hash`,
    [userId, key],
  );
  return toAuthUser(rows[0]!);
}

/**
 * Avatar key of `targetId`, but only if the viewer is that user or shares their active couple.
 * Returns null otherwise, so callers answer 404 rather than leaking that the account exists.
 */
export async function avatarKeyVisibleTo(viewerId: string, targetId: string): Promise<string | null> {
  const row = await queryOne<{ avatar_key: string | null }>(
    `select u.avatar_key
       from users u
      where u.id = $2
        and (
          u.id = $1
          or exists (
            select 1
              from couple_members a
              join couple_members b on a.couple_id = b.couple_id
             where a.user_id = $1 and b.user_id = $2
               and a.left_at is null and b.left_at is null
          )
        )`,
    [viewerId, targetId],
  );
  return row?.avatar_key ?? null;
}
