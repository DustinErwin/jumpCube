-- Run once before scripts/createSearchCardsRpc.sql.
--
-- These are plain boolean columns so setup is quick. Do not make these
-- generated stored columns in Supabase's SQL editor; populating them can time
-- out on a large cards table.

alter table public.cards
add column if not exists is_artifact_type boolean default false,
add column if not exists is_battle_type boolean default false,
add column if not exists is_creature_type boolean default false,
add column if not exists is_enchantment_type boolean default false,
add column if not exists is_instant_type boolean default false,
add column if not exists is_land_type boolean default false,
add column if not exists is_planeswalker_type boolean default false,
add column if not exists is_sorcery_type boolean default false,
add column if not exists type_flags_backfilled boolean default false;
