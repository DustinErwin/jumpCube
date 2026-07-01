create or replace function public.replace_pack_cards(
  requested_pack_id uuid,
  requested_cards jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.packs
    where id = requested_pack_id
      and user_id = auth.uid()
  ) then
    raise exception 'Pack not found or not owned by current user';
  end if;

  if jsonb_typeof(coalesce(requested_cards, '[]'::jsonb)) <> 'array' then
    raise exception 'Pack cards payload must be an array';
  end if;

  delete from public.pack_cards
  where pack_id = requested_pack_id;

  insert into public.pack_cards (
    pack_id,
    card_id,
    card_search_id,
    variant_id,
    oracle_id,
    variation_id,
    quantity,
    manual_mechanic_bucket
  )
  select
    requested_pack_id,
    card_id,
    card_search_id,
    variant_id,
    oracle_id,
    variation_id,
    quantity,
    manual_mechanic_bucket
  from jsonb_to_recordset(coalesce(requested_cards, '[]'::jsonb)) as card_rows (
    card_id uuid,
    card_search_id uuid,
    variant_id uuid,
    oracle_id uuid,
    variation_id uuid,
    quantity integer,
    manual_mechanic_bucket text
  );
end;
$$;

grant execute on function public.replace_pack_cards(uuid, jsonb) to authenticated;
