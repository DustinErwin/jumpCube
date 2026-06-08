-- Run after scripts/backfillCardTypeFlagsBatch.sql returns updated_count = 0.
--
-- If the SQL editor times out, run these one statement at a time. Each index
-- targets the app's default search shape and keeps ORDER BY name cheap.

create index if not exists cards_search_artifact_name_idx
on public.cards (name)
where games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false
  and is_default_printing = true
  and is_artifact_type = true;

create index if not exists cards_search_battle_name_idx
on public.cards (name)
where games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false
  and is_default_printing = true
  and is_battle_type = true;

create index if not exists cards_search_creature_name_idx
on public.cards (name)
where games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false
  and is_default_printing = true
  and is_creature_type = true;

create index if not exists cards_search_enchantment_name_idx
on public.cards (name)
where games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false
  and is_default_printing = true
  and is_enchantment_type = true;

create index if not exists cards_search_instant_name_idx
on public.cards (name)
where games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false
  and is_default_printing = true
  and is_instant_type = true;

create index if not exists cards_search_land_name_idx
on public.cards (name)
where games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false
  and is_default_printing = true
  and is_land_type = true;

create index if not exists cards_search_planeswalker_name_idx
on public.cards (name)
where games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false
  and is_default_printing = true
  and is_planeswalker_type = true;

create index if not exists cards_search_sorcery_name_idx
on public.cards (name)
where games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false
  and is_default_printing = true
  and is_sorcery_type = true;

analyze public.cards;
