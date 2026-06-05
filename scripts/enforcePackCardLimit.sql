create or replace function public.enforce_pack_card_limit()
returns trigger
language plpgsql
as $$
declare
  total_quantity integer;
begin
  select coalesce(sum(quantity), 0)
    into total_quantity
  from public.pack_cards
  where pack_id = new.pack_id
    and card_id <> new.card_id;

  if total_quantity + new.quantity > 20 then
    raise exception 'Pack cannot contain more than 20 cards';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_pack_card_limit_before_insert_update
  on public.pack_cards;

create trigger enforce_pack_card_limit_before_insert_update
before insert or update on public.pack_cards
for each row
execute function public.enforce_pack_card_limit();
