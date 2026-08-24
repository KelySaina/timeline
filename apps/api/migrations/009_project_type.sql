-- What kind of thing a project is.
--
-- A finished project becomes a memory, and every memory has a type — so the type was being chosen
-- for them, and always the same one. "Go to Japan" is a trip; "the 3am talk we keep not having" is
-- a conversation. Asking once, when the project is written down, is better than guessing at the end.
--
-- The same nine as `events`, deliberately: this column feeds that one, and a project's own card
-- shows the same icon and colour the memory will. Kept as a check rather than an enum for the same
-- reason as everywhere else — ALTER TYPE cannot be rolled back inside a transaction.
alter table projects add column type text not null default 'milestone'
  check (type in
    ('milestone','memory','trip','birthday','gift','celebration','conversation','life','custom'));
