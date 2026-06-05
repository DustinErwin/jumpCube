alter table public.packs enable row level security;
alter table public.pack_cards enable row level security;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'packs'
  loop
    execute format(
      'drop policy if exists %I on public.packs',
      policy_record.policyname
    );
  end loop;

  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'pack_cards'
  loop
    execute format(
      'drop policy if exists %I on public.pack_cards',
      policy_record.policyname
    );
  end loop;
end $$;

drop policy if exists "Users can read their packs" on public.packs;
create policy "Users can read their packs"
  on public.packs
  for select
  using (
    auth.uid() = user_id
    or visibility = 'public'
  );

drop policy if exists "Users can insert their packs" on public.packs;
create policy "Users can insert their packs"
  on public.packs
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their packs" on public.packs;
create policy "Users can update their packs"
  on public.packs
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their packs" on public.packs;
create policy "Users can delete their packs"
  on public.packs
  for delete
  using (auth.uid() = user_id);

drop policy if exists "Users can read cards in their packs" on public.pack_cards;
create policy "Users can read cards in their packs"
  on public.pack_cards
  for select
  using (
    exists (
      select 1
      from public.packs
      where packs.id = pack_cards.pack_id
        and (
          packs.user_id = auth.uid()
          or packs.visibility = 'public'
        )
    )
  );

drop policy if exists "Users can insert cards in their packs" on public.pack_cards;
create policy "Users can insert cards in their packs"
  on public.pack_cards
  for insert
  with check (
    exists (
      select 1
      from public.packs
      where packs.id = pack_cards.pack_id
        and packs.user_id = auth.uid()
    )
  );

drop policy if exists "Users can update cards in their packs" on public.pack_cards;
create policy "Users can update cards in their packs"
  on public.pack_cards
  for update
  using (
    exists (
      select 1
      from public.packs
      where packs.id = pack_cards.pack_id
        and packs.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.packs
      where packs.id = pack_cards.pack_id
        and packs.user_id = auth.uid()
    )
  );

drop policy if exists "Users can delete cards in their packs" on public.pack_cards;
create policy "Users can delete cards in their packs"
  on public.pack_cards
  for delete
  using (
    exists (
      select 1
      from public.packs
      where packs.id = pack_cards.pack_id
        and packs.user_id = auth.uid()
    )
  );
