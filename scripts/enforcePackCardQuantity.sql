do $$
begin
  if exists (
    select 1
    from public.pack_cards
    where quantity < 1
  ) then
    raise exception 'Cannot add quantity constraint: pack_cards contains quantities below 1';
  end if;
end;
$$;

alter table public.pack_cards
  drop constraint if exists pack_cards_quantity_positive;

alter table public.pack_cards
  add constraint pack_cards_quantity_positive
  check (quantity >= 1);
