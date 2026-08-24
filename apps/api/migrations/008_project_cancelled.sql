-- A project can also be let go.
--
-- Removing one erases it; deciding not to do it is a different thing, and in a diary it is worth
-- keeping. "We talked about moving to Paris for two years and then decided not to" is part of the
-- story, and a list that only records wins is not an honest record of what the two of them wanted.
alter table projects drop constraint projects_status_check;
alter table projects add constraint projects_status_check
  check (status in ('idea', 'doing', 'done', 'cancelled'));

-- `completed_at` now means "when it stopped being open", whichever way it closed. Renaming the
-- column would churn every query for a word; the two states are told apart by `status`, which is
-- what any reader has to consult anyway.
comment on column projects.completed_at is
  'When the project closed — finished or let go. Null while it is still open.';
