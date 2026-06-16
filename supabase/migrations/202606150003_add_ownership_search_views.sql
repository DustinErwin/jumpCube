create or replace view public.card_search_with_ownership
with (security_invoker = true)
as
select
  card_search.*,
  exists (
    select 1
    from public.user_collection_items collection_item
    where collection_item.user_id = auth.uid()
      and collection_item.card_search_id = card_search.id
  ) as is_owned
from public.card_search;

create or replace view public.card_variants_with_ownership
with (security_invoker = true)
as
select
  card_variants.*,
  exists (
    select 1
    from public.card_search search_card
    join public.user_collection_items collection_item
      on collection_item.card_search_id = search_card.id
    where collection_item.user_id = auth.uid()
      and search_card.oracle_id = card_variants.oracle_id
  ) as is_owned
from public.card_variants;

grant select on public.card_search_with_ownership to authenticated;
grant select on public.card_variants_with_ownership to authenticated;

notify pgrst, 'reload schema';
