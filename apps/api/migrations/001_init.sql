-- Timeline MVP schema.
-- Every couple-scoped table carries couple_id so authorization is one predicate, not a join walk.

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  display_name  text not null,
  birthday      date,
  avatar_key    text,
  token_version integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table couples (
  id         uuid primary key default gen_random_uuid(),
  title      text,
  started_on date,
  theme      text not null default 'dawn',
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table couple_members (
  couple_id uuid not null references couples(id) on delete cascade,
  user_id   uuid not null references users(id) on delete cascade,
  role      text not null default 'partner' check (role in ('owner', 'partner')),
  joined_at timestamptz not null default now(),
  left_at   timestamptz,
  primary key (couple_id, user_id)
);

-- One *active* relationship per user. Leaving frees the slot; history is kept.
create unique index couple_members_one_active_per_user
  on couple_members (user_id) where left_at is null;

create table invitations (
  id          uuid primary key default gen_random_uuid(),
  couple_id   uuid not null references couples(id) on delete cascade,
  code        text not null unique,
  created_by  uuid not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  accepted_by uuid references users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index invitations_couple_idx on invitations (couple_id) where accepted_at is null and revoked_at is null;

create table events (
  id             uuid primary key default gen_random_uuid(),
  couple_id      uuid not null references couples(id) on delete cascade,
  created_by     uuid not null references users(id) on delete restrict,
  type           text not null check (type in
                   ('milestone','memory','trip','birthday','gift','celebration','conversation','life','custom')),
  title          text not null check (length(title) between 1 and 140),
  description    text,
  -- event_date is a calendar DATE on purpose: a first kiss happened on a day, not at a UTC instant.
  event_date     date not null,
  end_date       date,
  date_precision text not null default 'day' check (date_precision in ('day','month','year')),
  location       text,
  mood           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  constraint events_end_after_start check (end_date is null or end_date >= event_date)
);

create index events_timeline_idx on events (couple_id, event_date desc, created_at desc) where deleted_at is null;
create index events_type_idx     on events (couple_id, type) where deleted_at is null;

create table event_photos (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  couple_id   uuid not null references couples(id) on delete cascade,
  storage_key text not null,
  thumb_key   text not null,
  width       integer not null,
  height      integer not null,
  byte_size   integer not null,
  position    integer not null default 0,
  created_by  uuid not null references users(id) on delete restrict,
  created_at  timestamptz not null default now()
);

create index event_photos_event_idx on event_photos (event_id, position, created_at);

create table event_tags (
  event_id  uuid not null references events(id) on delete cascade,
  couple_id uuid not null references couples(id) on delete cascade,
  tag       text not null check (length(tag) between 1 and 40),
  primary key (event_id, tag)
);

create index event_tags_lookup_idx on event_tags (couple_id, tag);

create table recurring_events (
  id                 uuid primary key default gen_random_uuid(),
  couple_id          uuid not null references couples(id) on delete cascade,
  kind               text not null check (kind in ('anniversary','birthday','custom')),
  title              text not null,
  month              integer not null check (month between 1 and 12),
  day                integer not null check (day between 1 and 31),
  start_year         integer,
  source             text not null default 'custom'
                       check (source in ('couple_anniversary','member_birthday','custom')),
  source_user_id     uuid references users(id) on delete cascade,
  remind_days_before integer not null default 7 check (remind_days_before between 0 and 90),
  created_by         uuid not null references users(id) on delete restrict,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index recurring_events_couple_idx on recurring_events (couple_id, month, day);
-- Derived rows (the anniversary, each partner's birthday) exist at most once per source.
create unique index recurring_events_derived_uniq
  on recurring_events (couple_id, source, coalesce(source_user_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where source <> 'custom';
