-- Custom tags now live in tags/pack_tags. This legacy array remains only as a
-- compatibility bridge and must no longer reject packs using newer tag names.
alter table public.packs
drop constraint if exists packs_archetype_tags_check;
