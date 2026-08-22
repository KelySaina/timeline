-- Search that ignores accents.
--
-- 'Antsirabe' and 'Antsirabé' are the same place, and until now the search box disagreed in both
-- directions: neither spelling found the other. For a timeline full of Malagasy and French place
-- names that is a search box that fails on precisely the words it exists for.
--
-- `unaccent` is a trusted extension, so the database owner can create it without superuser rights.
create extension if not exists unaccent;

-- Deliberately no index. `unaccent()` is STABLE rather than IMMUTABLE — it reads a dictionary file —
-- so indexing it needs an IMMUTABLE wrapper function, and a wrapper that lies about immutability is
-- how you get an index that silently disagrees with the data after a dictionary change. A couple's
-- timeline is thousands of rows at the outside; a sequential scan over that is not worth the risk.
