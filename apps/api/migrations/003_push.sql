-- Push notifications: somewhere to send them, and enough to know when.
--
-- Until now nothing in this schema knew where anyone was, which is why the reminder column that
-- has existed since 001 never sent anything: "seven days before" has no moment without a place.
-- An IANA name rather than an offset, because an offset is wrong twice a year.
alter table users add column timezone text not null default 'UTC';

-- One row per browser on a device, which is what a push subscription actually is. It is not a
-- device the user names or manages: the endpoint is minted by the push service, rotated by it, and
-- revoked by it, so the row is disposable by design and cascades away with the user.
create table push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  -- The endpoint IS the identity as far as the push service is concerned, so it carries the
  -- uniqueness: re-subscribing the same browser must update a row, never add one.
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  -- Only to tell two devices apart in a list. Never parsed for behaviour.
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_sent_at timestamptz,
  -- Consecutive failures that were not an outright "gone". A push service answering 404 or 410
  -- means the subscription is dead and the row is deleted on the spot; everything else is
  -- transient and only worth acting on once it repeats.
  failures     integer not null default 0
);

create index push_subscriptions_user_idx on push_subscriptions (user_id);

-- What makes the scheduler safe to run in more than one replica, and safe to redeploy mid-tick:
-- the send is claimed by an insert before it is attempted, so the second claimant loses on the
-- primary key and sends nothing. Keyed by the *occurrence* rather than the row, so the same
-- anniversary sends again next year.
create table reminder_sends (
  user_id uuid not null references users(id) on delete cascade,
  -- 'recurring:<uuid>:<yyyy-mm-dd>' — the thing being reminded about, and which instance of it.
  key     text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);
