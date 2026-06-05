update public.packs
set name = left(
  coalesce(
    nullif(btrim(regexp_replace(name, '[[:cntrl:]]', '', 'g')), ''),
    'Unnamed Pack'
  ),
  40
)
where name is null
  or name <> left(
    coalesce(
      nullif(btrim(regexp_replace(name, '[[:cntrl:]]', '', 'g')), ''),
      'Unnamed Pack'
    ),
    40
  );

alter table public.packs
  drop constraint if exists packs_name_check;

alter table public.packs
  drop constraint if exists packs_name_valid;

alter table public.packs
  add constraint packs_name_valid
  check (
    name = btrim(name)
    and char_length(name) between 1 and 40
    and name !~ '[[:cntrl:]]'
  );

update public.cubes
set name = left(
  coalesce(
    nullif(btrim(regexp_replace(name, '[[:cntrl:]]', '', 'g')), ''),
    'Unnamed Cube'
  ),
  40
)
where name is null
  or name <> left(
    coalesce(
      nullif(btrim(regexp_replace(name, '[[:cntrl:]]', '', 'g')), ''),
      'Unnamed Cube'
    ),
    40
  );

alter table public.cubes
  drop constraint if exists cubes_name_check;

alter table public.cubes
  drop constraint if exists cubes_name_valid;

alter table public.cubes
  add constraint cubes_name_valid
  check (
    name = btrim(name)
    and char_length(name) between 1 and 40
    and name !~ '[[:cntrl:]]'
  );
