alter table public.packs
add column if not exists archetype_tags text[] not null default '{}';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'packs'
      and column_name = 'archetype_tag'
  ) then
    update public.packs
    set archetype_tags = array[archetype_tag]
    where archetype_tag is not null
      and coalesce(cardinality(archetype_tags), 0) = 0;
  end if;
end $$;

alter table public.packs
drop constraint if exists packs_archetype_tag_check;

alter table public.packs
drop constraint if exists packs_archetype_tags_check;

alter table public.packs
add constraint packs_archetype_tags_check
check (
  archetype_tags <@ array[
    'Aggro',
    'Midrange',
    'Control',
    'Tempo',
    'Combo',
    'Ramp'
  ]::text[]
);
