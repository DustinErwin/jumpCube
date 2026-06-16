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
