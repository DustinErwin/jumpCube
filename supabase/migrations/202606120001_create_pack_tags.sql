create or replace function public.is_valid_pack_tag_name(value text)
returns boolean
language sql
immutable
as $$
  select value ~ '^[A-Za-z]+( [A-Za-z]+){0,2}$'
    and coalesce((
      select bool_and(length(word) <= 12)
      from unnest(string_to_array(value, ' ')) as word
    ), false);
$$;

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null unique,
  color text not null default 'gray',
  created_by uuid references auth.users(id) on delete set null,
  usage_count integer not null default 0 check (usage_count >= 0),
  created_at timestamptz not null default now(),
  constraint tags_name_format check (public.is_valid_pack_tag_name(name)),
  constraint tags_normalized_name_format check (
    normalized_name = lower(name)
  ),
  constraint tags_color_palette check (
    color in ('red', 'orange', 'gold', 'green', 'blue', 'purple', 'gray')
  )
);

create table if not exists public.pack_tags (
  pack_id uuid not null references public.packs(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (pack_id, tag_id)
);

create index if not exists pack_tags_tag_id_idx on public.pack_tags(tag_id);
create index if not exists tags_usage_name_idx on public.tags(usage_count desc, name);

alter table public.tags enable row level security;
alter table public.pack_tags enable row level security;

create policy "Tags are readable by everyone"
on public.tags for select
using (true);

create policy "Authenticated users can create tags"
on public.tags for insert
to authenticated
with check (created_by = auth.uid());

create policy "Pack tags follow pack visibility"
on public.pack_tags for select
using (
  exists (
    select 1
    from public.packs
    where packs.id = pack_tags.pack_id
      and (packs.user_id = auth.uid() or packs.visibility = 'public')
  )
);

create policy "Pack owners can assign tags"
on public.pack_tags for insert
to authenticated
with check (
  assigned_by = auth.uid()
  and exists (
    select 1 from public.packs
    where packs.id = pack_tags.pack_id
      and packs.user_id = auth.uid()
  )
);

create policy "Pack owners can remove tags"
on public.pack_tags for delete
to authenticated
using (
  exists (
    select 1 from public.packs
    where packs.id = pack_tags.pack_id
      and packs.user_id = auth.uid()
  )
);

create or replace function public.refresh_tag_usage_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update public.tags
    set usage_count = greatest(usage_count - 1, 0)
    where id = old.tag_id;
    return old;
  end if;

  update public.tags
  set usage_count = usage_count + 1
  where id = new.tag_id;
  return new;
end;
$$;

create trigger refresh_tag_usage_count_after_insert
after insert on public.pack_tags
for each row execute function public.refresh_tag_usage_count();

create trigger refresh_tag_usage_count_after_delete
after delete on public.pack_tags
for each row execute function public.refresh_tag_usage_count();

insert into public.tags (name, normalized_name, color)
values
  ('Aggro', 'aggro', 'red'),
  ('Midrange', 'midrange', 'gold'),
  ('Control', 'control', 'blue'),
  ('Tempo', 'tempo', 'gray'),
  ('Combo', 'combo', 'purple'),
  ('Ramp', 'ramp', 'green')
on conflict (normalized_name) do nothing;

insert into public.tags (name, normalized_name, color)
select distinct
  initcap(lower(existing_tag)),
  lower(existing_tag),
  'gray'
from public.packs
cross join lateral unnest(coalesce(archetype_tags, array[]::text[])) existing_tag
where existing_tag ~ '^[A-Za-z]+( [A-Za-z]+){0,2}$'
  and not exists (
    select 1
    from unnest(string_to_array(existing_tag, ' ')) as word
    where length(word) > 12
  )
on conflict (normalized_name) do nothing;

insert into public.pack_tags (pack_id, tag_id, assigned_by)
select distinct packs.id, tags.id, packs.user_id
from public.packs
cross join lateral unnest(coalesce(packs.archetype_tags, array[]::text[])) existing_tag
join public.tags on tags.normalized_name = lower(existing_tag)
on conflict do nothing;
