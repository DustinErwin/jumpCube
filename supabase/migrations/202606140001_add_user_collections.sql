create table if not exists public.user_collection_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_search_id uuid not null references public.card_search(id) on delete cascade,
  variant_id uuid references public.card_variants(id) on delete cascade,
  finish text not null default 'nonfoil',
  quantity smallint not null,
  printing_key text generated always as (
    coalesce(variant_id::text, 'search:' || card_search_id::text)
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_collection_quantity_check check (quantity between 1 and 100),
  constraint user_collection_finish_check check (finish in ('nonfoil', 'foil', 'etched')),
  constraint user_collection_item_unique unique (user_id, printing_key, finish)
);

create index if not exists user_collection_user_card_idx
on public.user_collection_items(user_id, card_search_id);

alter table public.user_collection_items enable row level security;

drop policy if exists "Users can read their collection"
on public.user_collection_items;
create policy "Users can read their collection"
on public.user_collection_items for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can add to their collection"
on public.user_collection_items;
create policy "Users can add to their collection"
on public.user_collection_items for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can update their collection"
on public.user_collection_items;
create policy "Users can update their collection"
on public.user_collection_items for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Users can remove from their collection"
on public.user_collection_items;
create policy "Users can remove from their collection"
on public.user_collection_items for delete to authenticated
using (user_id = auth.uid());

create or replace function public.import_user_collection(
  requested_rows jsonb,
  requested_mode text default 'update'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  row_number integer;
  card_name text;
  set_code_value text;
  collector_number_value text;
  finish_value text;
  quantity_value integer;
  search_id uuid;
  variant_value uuid;
  match_count integer;
  errors jsonb := '[]'::jsonb;
  merged_errors jsonb;
  imported_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if requested_mode not in ('update', 'replace') then
    raise exception 'Invalid collection import mode';
  end if;

  if jsonb_typeof(requested_rows) <> 'array' then
    raise exception 'Collection rows must be a JSON array';
  end if;

  if jsonb_array_length(requested_rows) > 50000 then
    raise exception 'Collection imports are limited to 50000 rows';
  end if;

  create temporary table if not exists collection_import_valid (
    printing_key text not null,
    card_search_id uuid not null,
    variant_id uuid,
    finish text not null,
    quantity integer not null,
    source_rows text not null,
    primary key (printing_key, finish)
  ) on commit drop;
  truncate collection_import_valid;

  for item in select value from jsonb_array_elements(requested_rows)
  loop
    row_number := coalesce((item->>'row_number')::integer, 0);
    card_name := trim(coalesce(item->>'name', ''));
    set_code_value := lower(trim(coalesce(item->>'set_code', '')));
    collector_number_value := trim(coalesce(item->>'collector_number', ''));
    finish_value := lower(trim(coalesce(item->>'finish', 'nonfoil')));

    begin
      quantity_value := (item->>'quantity')::integer;
    exception when others then
      quantity_value := null;
    end;

    if card_name = '' then
      errors := errors || jsonb_build_array(jsonb_build_object(
        'row_number', row_number, 'name', card_name,
        'error', 'Card name is required.'
      ));
      continue;
    end if;

    if quantity_value is null or quantity_value < 1 or quantity_value > 100 then
      errors := errors || jsonb_build_array(jsonb_build_object(
        'row_number', row_number, 'name', card_name,
        'quantity', item->>'quantity',
        'error', 'Quantity must be a whole number between 1 and 100.'
      ));
      continue;
    end if;

    if finish_value not in ('nonfoil', 'foil', 'etched') then
      errors := errors || jsonb_build_array(jsonb_build_object(
        'row_number', row_number, 'name', card_name,
        'error', 'Finish must be nonfoil, foil, or etched.'
      ));
      continue;
    end if;

    search_id := null;
    variant_value := null;

    if set_code_value <> '' and collector_number_value <> '' then
      select count(*) into match_count
      from public.card_variants variant
      where lower(variant.set_code) = set_code_value
        and lower(variant.collector_number) = lower(collector_number_value)
        and lower(variant.name) = lower(card_name)
        and variant.lang = 'en';

      if match_count = 1 then
        select variant.id, search_card.id
        into variant_value, search_id
        from public.card_variants variant
        join public.card_search search_card on search_card.oracle_id = variant.oracle_id
        where lower(variant.set_code) = set_code_value
          and lower(variant.collector_number) = lower(collector_number_value)
          and lower(variant.name) = lower(card_name)
          and variant.lang = 'en'
        limit 1;
      end if;
    else
      select count(*) into match_count
      from public.card_search search_card
      where lower(search_card.name) = lower(card_name);

      if match_count = 1 then
        select search_card.id into search_id
        from public.card_search search_card
        where lower(search_card.name) = lower(card_name)
        limit 1;
      end if;
    end if;

    if match_count = 0 or search_id is null then
      errors := errors || jsonb_build_array(jsonb_build_object(
        'row_number', row_number, 'name', card_name,
        'set_code', set_code_value,
        'collector_number', collector_number_value,
        'error', 'Card printing could not be identified.'
      ));
      continue;
    end if;

    if match_count > 1 then
      errors := errors || jsonb_build_array(jsonb_build_object(
        'row_number', row_number, 'name', card_name,
        'error', 'Card matched more than one record. Include set and collector number.'
      ));
      continue;
    end if;

    insert into collection_import_valid (
      printing_key, card_search_id, variant_id, finish, quantity, source_rows
    ) values (
      coalesce(variant_value::text, 'search:' || search_id::text),
      search_id, variant_value, finish_value, quantity_value, row_number::text
    )
    on conflict (printing_key, finish) do update
    set quantity = collection_import_valid.quantity + excluded.quantity,
        source_rows = collection_import_valid.source_rows || ', ' || excluded.source_rows;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'row_number', source_rows,
    'name', printing_key,
    'quantity', quantity,
    'error', 'Merged duplicate rows exceed the maximum quantity of 100.'
  )), '[]'::jsonb)
  into merged_errors
  from collection_import_valid
  where quantity > 100;

  errors := errors || merged_errors;

  if jsonb_array_length(errors) > 0 then
    return jsonb_build_object('success', false, 'imported_count', 0, 'errors', errors);
  end if;

  if requested_mode = 'replace' then
    delete from public.user_collection_items where user_id = auth.uid();
  end if;

  insert into public.user_collection_items (
    user_id, card_search_id, variant_id, finish, quantity, updated_at
  )
  select auth.uid(), card_search_id, variant_id, finish, quantity, now()
  from collection_import_valid
  on conflict (user_id, printing_key, finish) do update
  set quantity = excluded.quantity, updated_at = now();

  get diagnostics imported_count = row_count;

  return jsonb_build_object(
    'success', true, 'imported_count', imported_count, 'errors', '[]'::jsonb
  );
end;
$$;

grant execute on function public.import_user_collection(jsonb, text)
to authenticated;

notify pgrst, 'reload schema';
