-- Run this in the Supabase SQL editor after applying the is_legal migration.
-- It is read-only. Each EXPLAIN ANALYZE executes the SELECT and reports the
-- chosen indexes, row estimates, buffer activity, planning time, and runtime.
--
-- Healthy signals:
-- - Bitmap Index Scan / Bitmap Heap Scan for broad text and array filters.
-- - card_search_is_legal_idx participates in the baseline or combined bitmap.
-- - Rows Removed by Filter is not dramatically larger than rows returned.
-- - No external merge sort or large temporary read/write counts.
--
-- Warning signals:
-- - Seq Scan over all of card_search for the baseline.
-- - Large estimate-vs-actual differences.
-- - High shared read counts after running the file a second time.
-- - Execution time remains high on the second run with a warm cache.

begin;

set local statement_timeout = '30s';
set local lock_timeout = '3s';

-- Confirm the expected search indexes exist before interpreting the plans.
select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'card_search'
  and (
    indexname like '%search_text%'
    or indexname like '%games%'
    or indexname like '%color_identity%'
    or indexname like '%mana_value%'
    or indexname like '%rarity%'
    or indexname like '%set_code%'
    or indexname like '%is_legal%'
  )
order by indexname;

-- Test 1: baseline eligibility query.
-- This isolates the common predicates included in every application search.
explain (
  analyze,
  buffers,
  verbose,
  settings,
  summary,
  timing off
)
select
  id,
  name
from public.card_search
where games @> array['paper']::text[]
  and is_legal = true
  and is_token = false
  and is_planechase = false
  and layout <> 'art_series'
  and layout <> 'scheme'
  and (
    normalized_type_line like '%artifact%'
    or normalized_type_line like '%battle%'
    or normalized_type_line like '%creature%'
    or normalized_type_line like '%enchantment%'
    or normalized_type_line like '%instant%'
    or normalized_type_line like '%kindred%'
    or normalized_type_line like '%land%'
    or normalized_type_line like '%planeswalker%'
    or normalized_type_line like '%sorcery%'
    or normalized_type_line like '%tribal%'
  )
order by name
limit 50;

-- Test 2: deliberately broad text search across Title, Type, and Text.
-- "card" is common enough to stress the trigram path and final name sort.
explain (
  analyze,
  buffers,
  verbose,
  settings,
  summary,
  timing off
)
select
  id,
  oracle_id,
  default_variant_id,
  name,
  mana_value,
  color_identity,
  type_line,
  rarity,
  image_url,
  price_usd
from public.card_search
where games @> array['paper']::text[]
  and is_legal = true
  and is_token = false
  and is_planechase = false
  and layout <> 'art_series'
  and layout <> 'scheme'
  and (
    normalized_type_line like '%artifact%'
    or normalized_type_line like '%battle%'
    or normalized_type_line like '%creature%'
    or normalized_type_line like '%enchantment%'
    or normalized_type_line like '%instant%'
    or normalized_type_line like '%kindred%'
    or normalized_type_line like '%land%'
    or normalized_type_line like '%planeswalker%'
    or normalized_type_line like '%sorcery%'
    or normalized_type_line like '%tribal%'
  )
  and (
    search_text ilike '%card%'
    or name ilike '%card%'
    or normalized_type_line like '%card%'
    or oracle_text ilike '%card%'
  )
order by name
limit 50;

-- Test 3: realistic heavy stacked search.
-- Mirrors:
--   search "draw card"
--   colors W/U/B in And mode
--   mana values 2, 3, 4, and 7+
--   rare or mythic
--   Creature filter
--   Commander format
--   several commonly searched set codes
explain (
  analyze,
  buffers,
  verbose,
  settings,
  summary,
  timing off
)
select
  id,
  oracle_id,
  default_variant_id,
  default_variant_scryfall_id,
  name,
  mana_value,
  color_identity,
  type_line,
  oracle_text,
  rarity,
  image_url,
  legalities,
  price_usd,
  set_name,
  set_code,
  collector_number
from public.card_search
where games @> array['paper']::text[]
  and is_legal = true
  and is_token = false
  and is_planechase = false
  and layout <> 'art_series'
  and layout <> 'scheme'
  and (
    normalized_type_line like '%artifact%'
    or normalized_type_line like '%battle%'
    or normalized_type_line like '%creature%'
    or normalized_type_line like '%enchantment%'
    or normalized_type_line like '%instant%'
    or normalized_type_line like '%kindred%'
    or normalized_type_line like '%land%'
    or normalized_type_line like '%planeswalker%'
    or normalized_type_line like '%sorcery%'
    or normalized_type_line like '%tribal%'
  )
  and (
    search_text ilike '%draw%'
    or name ilike '%draw%'
    or normalized_type_line like '%draw%'
    or oracle_text ilike '%draw%'
  )
  and (
    search_text ilike '%card%'
    or name ilike '%card%'
    or normalized_type_line like '%card%'
    or oracle_text ilike '%card%'
  )
  and rarity in ('rare', 'mythic')
  and (
    mana_value in (2, 3, 4)
    or mana_value >= 7
  )
  and normalized_type_line like '%creature%'
  and legalities @> '{"commander":"legal"}'::jsonb
  and set_code in ('dmu', 'bro', 'one', 'mom', 'woe', 'lci', 'mkm', 'otj')
  and color_identity <@ array['W', 'U', 'B']::text[]
  and color_identity && array['W', 'U', 'B']::text[]
order by name
limit 50;

rollback;
