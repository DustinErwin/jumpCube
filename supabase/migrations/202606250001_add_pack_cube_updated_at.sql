alter table public.packs
add column if not exists updated_at timestamptz not null default now();

alter table public.cubes
add column if not exists updated_at timestamptz not null default now();

update public.packs
set updated_at = coalesce(updated_at, created_at, now());

update public.cubes
set updated_at = coalesce(updated_at, created_at, now());

create or replace function public.set_pack_cube_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_packs_updated_at on public.packs;

create trigger set_packs_updated_at
before update
on public.packs
for each row
execute function public.set_pack_cube_updated_at();

drop trigger if exists set_cubes_updated_at on public.cubes;

create trigger set_cubes_updated_at
before update
on public.cubes
for each row
execute function public.set_pack_cube_updated_at();

create index if not exists packs_user_updated_at_idx
on public.packs (user_id, updated_at desc);

create index if not exists cubes_user_updated_at_idx
on public.cubes (user_id, updated_at desc);

notify pgrst, 'reload schema';
