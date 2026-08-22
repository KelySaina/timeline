-- How the couple wants their story drawn.
--
-- Sits beside `theme` and works the same way: it belongs to the relationship rather than the
-- device, so both partners read the story in the same shape, and a change reaches the other side
-- over the change stream without a refresh.
--
-- Stored as text with a check rather than a Postgres enum, matching `theme`: adding a layout is
-- then a migration that edits one constraint instead of an ALTER TYPE that cannot be rolled back
-- inside a transaction. 'rail' is the layout every existing couple has been reading all along,
-- so it is the default and no row needs backfilling.
alter table couples
  add column story_layout text not null default 'rail';

alter table couples
  add constraint couples_story_layout_check
  check (story_layout in ('rail', 'road', 'route', 'album', 'reel', 'heartline'));
