-- Run after scripts/addCardTypeFlags.sql and the type flag backfill.
--
-- These indexes target searches like:
--   "enters the battlefield" + Type: Enchantment
--
-- The phrase is converted by the app to modern Oracle wording, "enters".
-- Because that word is common, a global oracle_text trigram index may still be
-- too broad. These partial trigram indexes let Postgres search Oracle text
-- inside the selected type bucket.
--
-- If the SQL editor times out, run one create-index statement at a time. For
-- the current Enchantment timeout, start with cards_search_enchantment_oracle_text_trgm_idx.

create extension if not exists pg_trgm;

create index if not exists cards_search_artifact_oracle_text_trgm_idx
on public.cards using gin (oracle_text gin_trgm_ops)
where games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false
  and is_default_printing = true
  and is_artifact_type = true;

create index if not exists cards_search_battle_oracle_text_trgm_idx
on public.cards using gin (oracle_text gin_trgm_ops)
where games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false
  and is_default_printing = true
  and is_battle_type = true;

create index if not exists cards_search_creature_oracle_text_trgm_idx
on public.cards using gin (oracle_text gin_trgm_ops)
where games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false
  and is_default_printing = true
  and is_creature_type = true;

create index if not exists cards_search_enchantment_oracle_text_trgm_idx
on public.cards using gin (oracle_text gin_trgm_ops)
where games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false
  and is_default_printing = true
  and is_enchantment_type = true;

create index if not exists cards_search_instant_oracle_text_trgm_idx
on public.cards using gin (oracle_text gin_trgm_ops)
where games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false
  and is_default_printing = true
  and is_instant_type = true;

create index if not exists cards_search_land_oracle_text_trgm_idx
on public.cards using gin (oracle_text gin_trgm_ops)
where games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false
  and is_default_printing = true
  and is_land_type = true;

create index if not exists cards_search_planeswalker_oracle_text_trgm_idx
on public.cards using gin (oracle_text gin_trgm_ops)
where games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false
  and is_default_printing = true
  and is_planeswalker_type = true;

create index if not exists cards_search_sorcery_oracle_text_trgm_idx
on public.cards using gin (oracle_text gin_trgm_ops)
where games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false
  and is_default_printing = true
  and is_sorcery_type = true;

analyze public.cards;
