drop function if exists public.refresh_card_search_games();

create or replace function public.refresh_card_search_paper_availability()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_count bigint;
begin
  with paper_oracle_ids as materialized (
    select distinct variant.oracle_id
    from public.card_variants variant
    where variant.games @> array['paper']::text[]
      and variant.oracle_id is not null
  )
  update public.card_search search_card
  set games = array_append(
    coalesce(search_card.games, '{}'::text[]),
    'paper'
  )
  from paper_oracle_ids
  where paper_oracle_ids.oracle_id = search_card.oracle_id
    and not coalesce(search_card.games, '{}'::text[])
      @> array['paper']::text[];

  get diagnostics updated_count = row_count;

  return updated_count;
end;
$$;

comment on function public.refresh_card_search_paper_availability() is
  'Adds paper to card_search.games when any card_variants printing with the same oracle_id supports paper. Run after card imports.';

revoke all on function public.refresh_card_search_paper_availability()
  from public;
grant execute on function public.refresh_card_search_paper_availability()
  to service_role;

select public.refresh_card_search_paper_availability();

select
  name,
  games
from public.card_search
where name in ('Evolving Wilds', 'Terramorphic Expanse')
order by name;

notify pgrst, 'reload schema';
