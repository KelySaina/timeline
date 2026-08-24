-- Things the two of them mean to do, which have no date yet.
--
-- The timeline holds what happened and what is planned for a day. A project is the third thing: a
-- want, with no date attached — "learn to dive", "repaint the kitchen". It cannot live on the
-- timeline precisely because it has no date, so it gets its own table rather than a nullable
-- `event_date`, which would put a hole in the one column the whole story sorts by.
--
-- What ties it back to the timeline is the end: finishing a project can turn it into a memory, and
-- `event_id` records which one. That is the join that makes this belong in this app rather than
-- being a shared todo list.
create table projects (
  id           uuid primary key default gen_random_uuid(),
  couple_id    uuid not null references couples(id) on delete cascade,
  title        text not null check (length(title) between 1 and 140),
  notes        text,
  -- 'idea' is a want, 'doing' is underway, 'done' is behind them. Text plus a check rather than an
  -- enum, matching theme and story_layout: ALTER TYPE cannot be rolled back inside a transaction.
  status       text not null default 'idea' check (status in ('idea', 'doing', 'done')),
  -- A hope, never a deadline: null means "someday", which is a real and common answer. Nothing is
  -- ever reminded about it — a project that nags is a chore.
  target_year  integer check (target_year is null or target_year between 1900 and 2200),
  -- Whose idea it was. Half the pleasure of a shared list is remembering who wanted what.
  created_by   uuid not null references users(id) on delete restrict,
  completed_at timestamptz,
  -- The memory it became, if it became one. Null on delete rather than cascade: losing the memory
  -- must not lose the record that the project was finished.
  event_id     uuid references events(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index projects_couple_idx on projects (couple_id, status, created_at desc);

-- The steps of one project. Optional: plenty of projects are a single sentence, and forcing a
-- checklist onto "go to Japan" is how a list stops being used.
create table project_steps (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  -- Denormalised so a step can be reached under the couple check without joining every time, the
  -- same way event_photos and event_tags carry it.
  couple_id  uuid not null references couples(id) on delete cascade,
  title      text not null check (length(title) between 1 and 200),
  done_at    timestamptz,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);

create index project_steps_project_idx on project_steps (project_id, position, created_at);
