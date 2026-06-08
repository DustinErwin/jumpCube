-- Run repeatedly until updated_count returns 0.
--
-- If 5000 still times out on your Supabase project, lower the limit to 1000.

with batch as (
  select id
  from public.cards
  where type_flags_backfilled is distinct from true
  order by id
  limit 5000
),
updated as (
  update public.cards as cards
  set
    is_artifact_type = strpos(coalesce(cards.type_line, ''), 'Artifact') > 0,
    is_battle_type = strpos(coalesce(cards.type_line, ''), 'Battle') > 0,
    is_creature_type = strpos(coalesce(cards.type_line, ''), 'Creature') > 0,
    is_enchantment_type = strpos(coalesce(cards.type_line, ''), 'Enchantment') > 0,
    is_instant_type = strpos(coalesce(cards.type_line, ''), 'Instant') > 0,
    is_land_type = strpos(coalesce(cards.type_line, ''), 'Land') > 0,
    is_planeswalker_type = strpos(coalesce(cards.type_line, ''), 'Planeswalker') > 0,
    is_sorcery_type = strpos(coalesce(cards.type_line, ''), 'Sorcery') > 0,
    type_flags_backfilled = true
  from batch
  where cards.id = batch.id
  returning 1
)
select count(*) as updated_count
from updated;
