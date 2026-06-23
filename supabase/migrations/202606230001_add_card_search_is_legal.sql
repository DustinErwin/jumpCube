alter table public.card_search
add column if not exists is_legal boolean not null default false;

update public.card_search
set is_legal = exists (
  select 1
  from jsonb_each_text(coalesce(legalities, '{}'::jsonb)) as legality
  where legality.value = 'legal'
);

create or replace function public.set_card_search_is_legal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.is_legal := exists (
    select 1
    from jsonb_each_text(coalesce(new.legalities, '{}'::jsonb)) as legality
    where legality.value = 'legal'
  );

  return new;
end;
$$;

drop trigger if exists set_card_search_is_legal on public.card_search;

create trigger set_card_search_is_legal
before insert or update of legalities
on public.card_search
for each row
execute function public.set_card_search_is_legal();

create index if not exists card_search_is_legal_idx
on public.card_search (is_legal)
where is_legal = true;

drop view if exists public.card_search_with_ownership;

create view public.card_search_with_ownership
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

grant select on public.card_search_with_ownership to authenticated;

notify pgrst, 'reload schema';
