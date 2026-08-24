-- Reminders for a one-off plan, not just for a date that recurs.
--
-- `recurring_events` has carried a lead time since 001; a plan on the timeline — a trip, a dinner,
-- a promise with a date on it — had no way to warn anyone. Same column, same meaning, on the row
-- that actually holds the plan.
--
-- Nullable, and null means no reminder. That is the difference from the recurring table, where every
-- row has a lead time because every row is a date someone chose to track: a memory is usually in the
-- past, and defaulting the whole timeline to "remind me" would be a notification for every
-- anniversary of nothing.
alter table events add column remind_days_before integer
  check (remind_days_before is null or remind_days_before between 0 and 90);

-- Only future-dated rows with a lead time are ever looked at, and there are few of them among all
-- the memories. Partial, so the index stays the size of the plans rather than the size of the story.
create index events_reminder_idx on events (couple_id, event_date)
  where deleted_at is null and remind_days_before is not null;
