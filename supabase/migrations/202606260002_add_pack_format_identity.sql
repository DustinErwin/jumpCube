alter table public.packs
add column if not exists format_id text not null default 'jumpstart',
add column if not exists commander_card_id uuid;

alter table public.packs
drop constraint if exists packs_format_id_check;

alter table public.packs
add constraint packs_format_id_check
check (format_id in ('jumpstart', 'commander'));

create index if not exists packs_format_id_idx
on public.packs (format_id);

create or replace function public.enforce_pack_card_limit()
returns trigger
language plpgsql
as $$
declare
  total_quantity integer;
  pack_limit integer;
begin
  if new.quantity < 1 then
    raise exception 'Pack card quantity must be at least 1';
  end if;

  select
    case packs.format_id
      when 'commander' then 30
      else 20
    end
    into pack_limit
  from public.packs
  where packs.id = new.pack_id;

  if tg_op = 'UPDATE' then
    select coalesce(sum(quantity), 0)
      into total_quantity
    from public.pack_cards
    where pack_id = new.pack_id
      and not (
        card_search_id is not distinct from old.card_search_id
        and variant_id is not distinct from old.variant_id
        and oracle_id is not distinct from old.oracle_id
        and variation_id is not distinct from old.variation_id
      );
  else
    select coalesce(sum(quantity), 0)
      into total_quantity
    from public.pack_cards
    where pack_id = new.pack_id;
  end if;

  if total_quantity + new.quantity > coalesce(pack_limit, 20) then
    raise exception 'Pack cannot contain more than % cards', coalesce(pack_limit, 20);
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_pack_card_limit_before_insert_update
on public.pack_cards;

create trigger enforce_pack_card_limit_before_insert_update
before insert or update on public.pack_cards
for each row
execute function public.enforce_pack_card_limit();

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
    user_id,
    name,
    description,
    archetype_tags,
    visibility,
    cover_image_url,
    format_id,
    commander_card_id
  ) values (
    destination_user_id,
    source_pack.name || ' Copy',
    source_pack.description,
    source_pack.archetype_tags,
    'private',
    source_pack.cover_image_url,
    source_pack.format_id,
    source_pack.commander_card_id
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

create or replace function public.save_user_cube(
  requested_cube_id uuid,
  requested_name text,
  requested_description text,
  requested_visibility text,
  requested_cover_image_url text,
  requested_pack_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_cube_id uuid;
  current_pack_id uuid;
  pack_position integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if requested_visibility not in ('private', 'public') then
    raise exception 'Invalid cube visibility';
  end if;

  if requested_cube_id is null then
    insert into public.cubes (
      user_id,
      name,
      description,
      visibility,
      cover_image_url
    ) values (
      auth.uid(),
      requested_name,
      requested_description,
      requested_visibility,
      requested_cover_image_url
    )
    returning id into saved_cube_id;
  else
    update public.cubes
    set
      name = requested_name,
      description = requested_description,
      visibility = requested_visibility,
      cover_image_url = requested_cover_image_url
    where id = requested_cube_id
      and user_id = auth.uid()
    returning id into saved_cube_id;

    if saved_cube_id is null then
      raise exception 'Cube not found or not owned by current user';
    end if;
  end if;

  if exists (
    select 1
    from unnest(coalesce(requested_pack_ids, array[]::uuid[])) requested_pack_id
    left join public.packs
      on packs.id = requested_pack_id
      and packs.user_id = auth.uid()
    where packs.id is null
  ) then
    raise exception 'Cube contains a pack not owned by current user';
  end if;

  if (
    select count(distinct packs.format_id)
    from unnest(coalesce(requested_pack_ids, array[]::uuid[])) requested_pack_id
    join public.packs
      on packs.id = requested_pack_id
      and packs.user_id = auth.uid()
  ) > 1 then
    raise exception 'Cube packs must all use the same format';
  end if;

  delete from public.cube_packs
  where cube_id = saved_cube_id;

  foreach current_pack_id in array coalesce(requested_pack_ids, array[]::uuid[])
  loop
    insert into public.cube_packs (cube_id, pack_id, position)
    values (saved_cube_id, current_pack_id, pack_position);
    pack_position := pack_position + 1;
  end loop;

  return saved_cube_id;
end;
$$;

grant execute on function public.save_user_cube(
  uuid, text, text, text, text, uuid[]
) to authenticated;
