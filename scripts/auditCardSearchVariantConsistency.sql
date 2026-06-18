-- Read-only audit for card_search identity rows that disagree with available
-- playable card_variants printings.
--
-- Run this in Supabase SQL editor. It does not mutate data.

with playable_variants as (
  select
    variant.oracle_id,
    count(*) as playable_variant_count,
    count(*) filter (where variant.nonfoil) as nonfoil_variant_count,
    count(*) filter (where variant.foil) as foil_variant_count,
    count(*) filter (where variant.image_url is not null) as image_variant_count,
    array_agg(distinct variant.set_code order by variant.set_code)
      filter (where variant.nonfoil) as nonfoil_sets,
    array_agg(variant.id order by
      case when variant.nonfoil then 0 else 1 end,
      case when variant.image_url is not null then 0 else 1 end,
      variant.released_at nulls last,
      variant.collector_number
    )[1] as preferred_variant_id
  from public.card_variants variant
  where variant.games @> array['paper']::text[]
    and variant.is_token = false
    and variant.is_funny = false
    and variant.is_planechase = false
    and coalesce(variant.layout, '') <> 'art_series'
    and coalesce(variant.layout, '') <> 'scheme'
  group by variant.oracle_id
),
summary as (
  select
    count(*) as card_search_rows,
    count(*) filter (where playable.oracle_id is null) as rows_without_playable_variant,
    count(*) filter (
      where search.nonfoil = false
        and coalesce(playable.nonfoil_variant_count, 0) > 0
    ) as rows_marked_nonfoil_false_but_variant_exists,
    count(*) filter (
      where search.foil = false
        and coalesce(playable.foil_variant_count, 0) > 0
    ) as rows_marked_foil_false_but_variant_exists,
    count(*) filter (
      where search.default_variant_id is null
        and playable.preferred_variant_id is not null
    ) as rows_missing_default_variant,
    count(*) filter (
      where search.default_variant_id is not null
        and search.default_variant_id <> playable.preferred_variant_id
    ) as rows_default_variant_not_preferred
  from public.card_search search
  left join playable_variants playable
    on playable.oracle_id = search.oracle_id
)
select * from summary;

-- Rows like Ezuri, Renegade Leader: normal search excludes these today because
-- card_search.nonfoil is false even though a playable nonfoil variant exists.
with playable_variants as (
  select
    variant.oracle_id,
    count(*) filter (where variant.nonfoil) as nonfoil_variant_count,
    array_agg(distinct variant.set_code order by variant.set_code)
      filter (where variant.nonfoil) as nonfoil_sets,
    array_agg(variant.id order by
      case when variant.nonfoil then 0 else 1 end,
      case when variant.image_url is not null then 0 else 1 end,
      variant.released_at nulls last,
      variant.collector_number
    )[1] as preferred_variant_id
  from public.card_variants variant
  where variant.games @> array['paper']::text[]
    and variant.is_token = false
    and variant.is_funny = false
    and variant.is_planechase = false
    and coalesce(variant.layout, '') <> 'art_series'
    and coalesce(variant.layout, '') <> 'scheme'
  group by variant.oracle_id
)
select
  search.id as card_search_id,
  search.name,
  search.oracle_id,
  search.nonfoil as card_search_nonfoil,
  playable.nonfoil_variant_count,
  playable.nonfoil_sets,
  search.default_variant_id,
  playable.preferred_variant_id,
  default_variant.set_code as current_default_set,
  preferred_variant.set_code as preferred_default_set
from public.card_search search
join playable_variants playable
  on playable.oracle_id = search.oracle_id
left join public.card_variants default_variant
  on default_variant.id = search.default_variant_id
left join public.card_variants preferred_variant
  on preferred_variant.id = playable.preferred_variant_id
where search.nonfoil = false
  and playable.nonfoil_variant_count > 0
order by search.name
limit 200;

-- Exact check for the reported card.
select
  search.id as card_search_id,
  search.name,
  search.oracle_id,
  search.nonfoil as card_search_nonfoil,
  search.default_variant_id,
  variant.id as variant_id,
  variant.set_code,
  variant.collector_number,
  variant.nonfoil as variant_nonfoil,
  variant.foil as variant_foil,
  variant.image_url is not null as has_image
from public.card_search search
left join public.card_variants variant
  on variant.oracle_id = search.oracle_id
where search.name = 'Ezuri, Renegade Leader'
order by
  case when variant.nonfoil then 0 else 1 end,
  variant.set_code,
  variant.collector_number;
