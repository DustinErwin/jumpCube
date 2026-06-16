create index if not exists card_variants_collection_number_lookup_idx
on public.card_variants(
  lower(set_code),
  lower(regexp_replace(trim(collector_number), '^0+([0-9])', '\1'))
);

create index if not exists card_search_lower_name_idx
on public.card_search(lower(name));

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
  import_errors jsonb;
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

  create temporary table collection_import_rows on commit drop as
  select
    case
      when trim(coalesce(source.row_number, '')) ~ '^[0-9]+$'
        then trim(source.row_number)::integer
      else 0
    end as row_number,
    trim(coalesce(source.name, '')) as card_name,
    lower(trim(coalesce(source.set_code, ''))) as set_code_value,
    lower(regexp_replace(
      trim(coalesce(source.collector_number, '')),
      '^0+([0-9])',
      '\1'
    )) as collector_number_value,
    coalesce(nullif(lower(trim(source.finish)), ''), 'nonfoil') as finish_value,
    source.quantity as quantity_text,
    case
      when trim(coalesce(source.quantity, '')) ~ '^[0-9]+$'
        then trim(source.quantity)::integer
      else null
    end as quantity_value
  from jsonb_to_recordset(requested_rows) as source(
    row_number text,
    name text,
    set_code text,
    collector_number text,
    quantity text,
    finish text
  );

  create index collection_import_rows_printing_idx
  on collection_import_rows(set_code_value, collector_number_value);
  create index collection_import_rows_name_idx
  on collection_import_rows(lower(card_name));
  analyze collection_import_rows;

  create temporary table collection_import_exact_keys on commit drop as
  select distinct set_code_value, collector_number_value
  from collection_import_rows
  where set_code_value <> '' and collector_number_value <> '';

  create index collection_import_exact_keys_idx
  on collection_import_exact_keys(set_code_value, collector_number_value);
  analyze collection_import_exact_keys;

  create temporary table collection_import_exact_candidates on commit drop as
  select
    keys.set_code_value,
    keys.collector_number_value,
    variant.id as variant_id,
    variant.oracle_id,
    search_card.id as card_search_id,
    variant.lang
  from collection_import_exact_keys keys
  join public.card_variants variant
    on lower(variant.set_code) = keys.set_code_value
   and lower(regexp_replace(
     trim(variant.collector_number),
     '^0+([0-9])',
     '\1'
   )) = keys.collector_number_value
  join public.card_search search_card
    on search_card.oracle_id = variant.oracle_id;

  create index collection_import_exact_candidates_idx
  on collection_import_exact_candidates(set_code_value, collector_number_value);
  analyze collection_import_exact_candidates;

  create temporary table collection_import_exact_matches on commit drop as
  with summaries as (
    select
      set_code_value,
      collector_number_value,
      count(distinct oracle_id)::integer as match_count
    from collection_import_exact_candidates
    group by set_code_value, collector_number_value
  ), choices as (
    select distinct on (set_code_value, collector_number_value)
      set_code_value,
      collector_number_value,
      card_search_id,
      variant_id
    from collection_import_exact_candidates
    order by
      set_code_value,
      collector_number_value,
      (lang = 'en') desc,
      variant_id
  )
  select
    keys.set_code_value,
    keys.collector_number_value,
    coalesce(summaries.match_count, 0) as match_count,
    choices.card_search_id,
    choices.variant_id
  from collection_import_exact_keys keys
  left join summaries using (set_code_value, collector_number_value)
  left join choices using (set_code_value, collector_number_value);

  create unique index collection_import_exact_matches_idx
  on collection_import_exact_matches(set_code_value, collector_number_value);
  analyze collection_import_exact_matches;

  create temporary table collection_import_name_keys on commit drop as
  select distinct lower(card_name) as normalized_name
  from collection_import_rows
  where set_code_value = '' or collector_number_value = '';

  create unique index collection_import_name_keys_idx
  on collection_import_name_keys(normalized_name);
  analyze collection_import_name_keys;

  create temporary table collection_import_name_matches on commit drop as
  select
    keys.normalized_name,
    count(search_card.id)::integer as match_count,
    (array_agg(search_card.id order by search_card.id))[1] as card_search_id
  from collection_import_name_keys keys
  left join public.card_search search_card
    on lower(search_card.name) = keys.normalized_name
  group by keys.normalized_name;

  create unique index collection_import_name_matches_idx
  on collection_import_name_matches(normalized_name);
  analyze collection_import_name_matches;

  create temporary table collection_import_resolved on commit drop as
  select
    source.*,
    case
      when source.set_code_value <> '' and source.collector_number_value <> ''
        then coalesce(exact_match.match_count, 0)
      else coalesce(name_match.match_count, 0)
    end as match_count,
    case
      when source.set_code_value <> '' and source.collector_number_value <> ''
        then exact_match.card_search_id
      else name_match.card_search_id
    end as card_search_id,
    case
      when source.set_code_value <> '' and source.collector_number_value <> ''
        then exact_match.variant_id
      else null
    end as variant_id
  from collection_import_rows source
  left join collection_import_exact_matches exact_match
    on exact_match.set_code_value = source.set_code_value
   and exact_match.collector_number_value = source.collector_number_value
  left join collection_import_name_matches name_match
    on name_match.normalized_name = lower(source.card_name)
   and (source.set_code_value = '' or source.collector_number_value = '');

  create temporary table collection_import_valid on commit drop as
  select
    coalesce(variant_id::text, 'search:' || card_search_id::text) as printing_key,
    card_search_id,
    variant_id,
    finish_value as finish,
    sum(quantity_value)::integer as quantity,
    string_agg(row_number::text, ', ' order by row_number) as source_rows
  from collection_import_resolved
  where card_name <> ''
    and quantity_value between 1 and 100
    and finish_value in ('nonfoil', 'foil', 'etched')
    and match_count = 1
    and card_search_id is not null
  group by
    coalesce(variant_id::text, 'search:' || card_search_id::text),
    card_search_id,
    variant_id,
    finish_value;

  select coalesce(jsonb_agg(error_row order by sort_row), '[]'::jsonb)
  into import_errors
  from (
    select
      row_number as sort_row,
      jsonb_build_object(
        'row_number', row_number,
        'name', card_name,
        'quantity', quantity_text,
        'error', case
          when card_name = '' then 'Card name is required.'
          when quantity_value is null or quantity_value < 1 or quantity_value > 100
            then 'Quantity must be a whole number between 1 and 100.'
          when finish_value not in ('nonfoil', 'foil', 'etched')
            then 'Finish must be nonfoil, foil, or etched.'
          when match_count = 0 or card_search_id is null
            then 'Card printing could not be identified.'
          when match_count > 1
            then 'Set and collector number matched multiple cards.'
        end
      ) as error_row
    from collection_import_resolved
    where card_name = ''
      or quantity_value is null
      or quantity_value < 1
      or quantity_value > 100
      or finish_value not in ('nonfoil', 'foil', 'etched')
      or match_count <> 1
      or card_search_id is null

    union all

    select
      coalesce(nullif(split_part(source_rows, ',', 1), '')::integer, 0),
      jsonb_build_object(
        'row_number', source_rows,
        'name', printing_key,
        'quantity', quantity,
        'error', 'Merged duplicate rows exceed the maximum quantity of 100.'
      )
    from collection_import_valid
    where quantity > 100
  ) validation_errors;

  if jsonb_array_length(import_errors) > 0 then
    return jsonb_build_object(
      'success', false,
      'imported_count', 0,
      'errors', import_errors
    );
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
  set quantity = excluded.quantity,
      updated_at = now();

  get diagnostics imported_count = row_count;

  return jsonb_build_object(
    'success', true,
    'imported_count', imported_count,
    'errors', '[]'::jsonb
  );
end;
$$;

grant execute on function public.import_user_collection(jsonb, text)
to authenticated;

notify pgrst, 'reload schema';
