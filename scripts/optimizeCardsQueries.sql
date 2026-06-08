-- Run this in the Supabase SQL editor if card searches are timing out with
-- Postgres error 57014: "canceling statement due to statement timeout".
--
-- The cards UI filters by booleans, arrays, JSON legalities, set, mana value,
-- rarity, type text, card text, and then orders by name. These indexes target
-- those exact predicates from src/hooks/useCards.js.

create extension if not exists pg_trgm;

create index if not exists cards_default_name_idx
on public.cards (name)
where
  games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false
  and is_default_printing = true;

create index if not exists cards_set_name_idx
on public.cards (set_code, name)
where
  games @> array['paper']::text[]
  and nonfoil = true
  and is_token = false
  and is_funny = false
  and is_planechase = false;

create index if not exists cards_games_gin_idx
on public.cards using gin (games);

create index if not exists cards_color_identity_gin_idx
on public.cards using gin (color_identity);

create index if not exists cards_rarity_idx
on public.cards (rarity);

create index if not exists cards_mana_value_idx
on public.cards (mana_value);

create index if not exists cards_name_trgm_idx
on public.cards using gin (name gin_trgm_ops);

create index if not exists cards_type_line_trgm_idx
on public.cards using gin (type_line gin_trgm_ops);

create index if not exists cards_oracle_text_trgm_idx
on public.cards using gin (oracle_text gin_trgm_ops);

create index if not exists cards_legalities_standard_idx
on public.cards ((legalities->>'standard'));

create index if not exists cards_legalities_pioneer_idx
on public.cards ((legalities->>'pioneer'));

create index if not exists cards_legalities_modern_idx
on public.cards ((legalities->>'modern'));

create index if not exists cards_legalities_legacy_idx
on public.cards ((legalities->>'legacy'));

create index if not exists cards_legalities_vintage_idx
on public.cards ((legalities->>'vintage'));

create index if not exists cards_legalities_commander_idx
on public.cards ((legalities->>'commander'));
