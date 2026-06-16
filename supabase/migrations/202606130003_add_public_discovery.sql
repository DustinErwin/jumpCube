alter table public.cubes
add column if not exists visibility text not null default 'private';

alter table public.packs enable row level security;
alter table public.pack_cards enable row level security;
alter table public.cubes enable row level security;
alter table public.cube_packs enable row level security;

alter table public.packs
add column if not exists cover_image_url text;

alter table public.cubes
add column if not exists cover_image_url text;

alter table public.cubes
drop constraint if exists cubes_visibility_check;

alter table public.cubes
add constraint cubes_visibility_check
check (visibility in ('private', 'public'));

create policy "Public packs are discoverable"
on public.packs for select
using (visibility = 'public' or user_id = auth.uid());

create policy "Packs inside public cubes are discoverable"
on public.packs for select
using (
  exists (
    select 1
    from public.cube_packs
    join public.cubes on cubes.id = cube_packs.cube_id
    where cube_packs.pack_id = packs.id
      and cubes.visibility = 'public'
  )
);

create policy "Public cube metadata is discoverable"
on public.cubes for select
using (visibility = 'public' or user_id = auth.uid());

create policy "Public cube relationships are discoverable"
on public.cube_packs for select
using (
  exists (
    select 1 from public.cubes
    where cubes.id = cube_packs.cube_id
      and (cubes.visibility = 'public' or cubes.user_id = auth.uid())
  )
);

create policy "Public pack cards are discoverable"
on public.pack_cards for select
using (
  exists (
    select 1 from public.packs
    where packs.id = pack_cards.pack_id
      and (packs.visibility = 'public' or packs.user_id = auth.uid())
  )
);

create policy "Cards inside public cubes are discoverable"
on public.pack_cards for select
using (
  exists (
    select 1
    from public.cube_packs
    join public.cubes on cubes.id = cube_packs.cube_id
    where cube_packs.pack_id = pack_cards.pack_id
      and cubes.visibility = 'public'
  )
);

create policy "Tags inside public cubes are discoverable"
on public.pack_tags for select
using (
  exists (
    select 1
    from public.cube_packs
    join public.cubes on cubes.id = cube_packs.cube_id
    where cube_packs.pack_id = pack_tags.pack_id
      and cubes.visibility = 'public'
  )
);

drop policy if exists "Profile usernames are discoverable" on public.profiles;

create or replace function public.get_public_usernames(requested_user_ids uuid[])
returns table (id uuid, username text)
language sql
stable
security definer
set search_path = public
as $$
  select profiles.id, profiles.username
  from public.profiles
  where profiles.id = any(requested_user_ids);
$$;

grant execute on function public.get_public_usernames(uuid[]) to anon, authenticated;

create or replace function public.copy_public_pack(
  source_pack_id uuid,
  destination_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  source_pack public.packs%rowtype;
  new_pack_id uuid;
begin
  if auth.uid() is null or auth.uid() <> destination_user_id then
    raise exception 'You can only copy items into your own library';
  end if;

  select * into source_pack
  from public.packs
  where id = source_pack_id
    and (
      visibility = 'public'
      or exists (
        select 1
        from public.cube_packs
        join public.cubes on cubes.id = cube_packs.cube_id
        where cube_packs.pack_id = source_pack_id
          and cubes.visibility = 'public'
      )
    );

  if not found then
    raise exception 'Public pack not found';
  end if;

  insert into public.packs (
    user_id, name, description, archetype_tags, visibility, cover_image_url
  ) values (
    destination_user_id,
    source_pack.name || ' Copy',
    source_pack.description,
    source_pack.archetype_tags,
    'private',
    source_pack.cover_image_url
  )
  returning id into new_pack_id;

  insert into public.pack_cards (
    pack_id, card_id, card_search_id, variant_id, oracle_id,
    variation_id, quantity, manual_mechanic_bucket
  )
  select
    new_pack_id, card_id, card_search_id, variant_id, oracle_id,
    variation_id, quantity, manual_mechanic_bucket
  from public.pack_cards
  where pack_id = source_pack_id;

  insert into public.pack_tags (pack_id, tag_id, assigned_by)
  select new_pack_id, tag_id, destination_user_id
  from public.pack_tags
  where pack_id = source_pack_id
  on conflict do nothing;

  return new_pack_id;
end;
$$;

create or replace function public.copy_public_cube(
  source_cube_id uuid,
  destination_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  source_cube public.cubes%rowtype;
  source_pack record;
  new_cube_id uuid;
  new_pack_id uuid;
begin
  if auth.uid() is null or auth.uid() <> destination_user_id then
    raise exception 'You can only copy items into your own library';
  end if;

  select * into source_cube
  from public.cubes
  where id = source_cube_id and visibility = 'public';

  if not found then
    raise exception 'Public cube not found';
  end if;

  insert into public.cubes (
    user_id, name, description, visibility, cover_image_url
  )
  values (
    destination_user_id,
    source_cube.name || ' Copy',
    source_cube.description,
    'private',
    source_cube.cover_image_url
  )
  returning id into new_cube_id;

  for source_pack in
    select cube_packs.pack_id, cube_packs.position
    from public.cube_packs
    where cube_packs.cube_id = source_cube_id
    order by cube_packs.position
  loop
    new_pack_id := public.copy_public_pack(
      source_pack.pack_id,
      destination_user_id
    );

    insert into public.cube_packs (cube_id, pack_id, position)
    values (new_cube_id, new_pack_id, source_pack.position);
  end loop;

  return new_cube_id;
end;
$$;

grant execute on function public.copy_public_pack(uuid, uuid) to authenticated;
grant execute on function public.copy_public_cube(uuid, uuid) to authenticated;
