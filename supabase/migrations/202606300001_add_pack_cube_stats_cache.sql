alter table public.packs
add column if not exists color_identity text[] not null default '{}',
add column if not exists color_percentages jsonb not null default '{}'::jsonb,
add column if not exists cube_stats jsonb not null default '{}'::jsonb;

create index if not exists packs_color_identity_idx
on public.packs using gin (color_identity);

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
    commander_card_id,
    color_identity,
    color_percentages,
    cube_stats
  ) values (
    destination_user_id,
    source_pack.name || ' Copy',
    source_pack.description,
    source_pack.archetype_tags,
    'private',
    source_pack.cover_image_url,
    source_pack.format_id,
    source_pack.commander_card_id,
    source_pack.color_identity,
    source_pack.color_percentages,
    source_pack.cube_stats
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
