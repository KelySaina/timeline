-- Three kinds of notification, three separate answers.
--
-- Until now "has a subscription" meant "wants reminders", which was fine while reminders were the
-- only kind. Adding partner activity to that implicit yes would opt everyone into the noisy one
-- without asking — and activity is the kind that gets permission revoked for the other two.
--
-- Defaults encode what each one is worth. Reminders are why someone turned notifications on, so
-- they stay on. The other two are additions nobody has asked for yet, so they start off.
alter table users add column notify_reminders   boolean not null default true;
alter table users add column notify_activity    boolean not null default false;
alter table users add column notify_on_this_day boolean not null default false;

-- Renamed because it no longer claims only reminders. It is the exactly-once ledger for every kind
-- of send: each replica inserts before it delivers, so a notification with the same key is sent by
-- whichever replica gets there first and by nobody else.
--
-- Note for a rollback: reverting the images does not revert this rename, and the previous code
-- queries the old name. The reminder tick catches its own errors, so the effect is notifications
-- stopping rather than the API failing — but it does need this migration reversed by hand.
alter table reminder_sends rename to notification_sends;
