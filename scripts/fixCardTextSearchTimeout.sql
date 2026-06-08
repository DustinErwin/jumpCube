-- Run this in the Supabase SQL editor to fix card text searches such as
-- "boar" timing out for browser/public-key requests.
--
-- The app searches name, type_line, and oracle_text with ILIKE and also filters
-- by paper/nonfoil/non-token/non-funny/non-planechase/default-printing.

create extension if not exists pg_trgm;

create index if not exists cards_search_default_name_trgm_idx
on public.cards using gin (name gin_trgm_ops)
where
  games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false
  and is_default_printing = true;

create index if not exists cards_search_default_type_line_trgm_idx
on public.cards using gin (type_line gin_trgm_ops)
where
  games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false
  and is_default_printing = true;

create index if not exists cards_search_default_oracle_text_trgm_idx
on public.cards using gin (oracle_text gin_trgm_ops)
where
  games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false
  and is_default_printing = true;

create index if not exists cards_search_set_name_trgm_idx
on public.cards using gin (name gin_trgm_ops)
where
  games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false;

create index if not exists cards_search_set_type_line_trgm_idx
on public.cards using gin (type_line gin_trgm_ops)
where
  games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false;

create index if not exists cards_search_set_oracle_text_trgm_idx
on public.cards using gin (oracle_text gin_trgm_ops)
where
  games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false;

analyze public.cards;
