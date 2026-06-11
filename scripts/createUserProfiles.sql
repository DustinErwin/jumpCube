create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format_check
    check (username ~ '^[A-Za-z0-9]{3,31}$')
);

alter table public.profiles enable row level security;

drop policy if exists "Users can read their profile" on public.profiles;
create policy "Users can read their profile"
  on public.profiles
  for select
  using (auth.uid() = id);

drop policy if exists "Users can insert their profile" on public.profiles;
create policy "Users can insert their profile"
  on public.profiles
  for insert
  with check (auth.uid() = id);

drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row
  execute function public.set_profiles_updated_at();

create or replace function public.normalize_profile_username(
  requested_username text,
  email text
)
returns text
language sql
immutable
as $$
  select left(
    coalesce(
      nullif(
        trim(
          both '_' from lower(
            regexp_replace(
              coalesce(nullif(requested_username, ''), split_part(email, '@', 1), 'user'),
              '[^A-Za-z0-9]+',
              '',
              'g'
            )
          )
        ),
        ''
      ),
      'user'
    ),
    31
  );
$$;

create or replace function public.is_username_available(
  requested_username text
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select requested_username ~ '^[A-Za-z0-9]{3,31}$'
    and not exists (
      select 1
      from public.profiles
      where lower(profiles.username) = lower(requested_username)
    );
$$;

grant execute on function public.is_username_available(text) to anon;
grant execute on function public.is_username_available(text) to authenticated;

create or replace function public.is_email_available(
  requested_email text
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select requested_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and not exists (
      select 1
      from auth.users
      where lower(auth.users.email) = lower(trim(requested_email))
    );
$$;

grant execute on function public.is_email_available(text) to anon;
grant execute on function public.is_email_available(text) to authenticated;

create or replace function public.profile_username_for_user(
  user_id uuid,
  email text,
  requested_username text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  base_username text;
  candidate_username text;
begin
  if requested_username is not null
    and requested_username !~ '^[A-Za-z0-9]{3,31}$'
  then
    raise exception 'Username must be 3-31 letters or numbers.';
  end if;

  if requested_username is not null
    and exists (
      select 1
      from public.profiles
      where lower(username) = lower(requested_username)
        and id <> user_id
    )
  then
    raise exception 'Username is already taken.';
  end if;

  base_username := public.normalize_profile_username(requested_username, email);

  if length(base_username) < 3 then
    base_username := 'user';
  end if;

  candidate_username := base_username;

  if exists (
    select 1
    from public.profiles
    where lower(username) = lower(candidate_username)
      and id <> user_id
  ) then
    candidate_username := left(base_username, 23) || replace(left(user_id::text, 8), '-', '');
  end if;

  return left(candidate_username, 31);
end;
$$;

with profile_scan as (
  select
    profiles.id,
    profiles.username,
    row_number() over (partition by lower(profiles.username) order by profiles.id) as case_duplicate_number,
    case
      when length(public.normalize_profile_username(profiles.username, null)) < 3 then 'user'
      else public.normalize_profile_username(profiles.username, null)
    end as base_username
  from public.profiles
),
invalid_usernames as (
  select
    profile_scan.id,
    profile_scan.base_username,
    row_number() over (
      partition by profile_scan.base_username
      order by profile_scan.id
    ) as username_number
  from profile_scan
  where profile_scan.username !~ '^[A-Za-z0-9]{3,31}$'
    or profile_scan.case_duplicate_number > 1
),
fixed_usernames as (
  select
    id,
    case
      when username_number = 1
        and not exists (
          select 1
          from public.profiles
          where lower(profiles.username) = lower(invalid_usernames.base_username)
            and profiles.id <> invalid_usernames.id
        )
        then invalid_usernames.base_username
      else left(invalid_usernames.base_username, 23) || replace(left(invalid_usernames.id::text, 8), '-', '')
    end as username
  from invalid_usernames
)
update public.profiles
set username = fixed_usernames.username
from fixed_usernames
where profiles.id = fixed_usernames.id;

alter table public.profiles
  drop constraint if exists profiles_username_format_check;

alter table public.profiles
  add constraint profiles_username_format_check
  check (username ~ '^[A-Za-z0-9]{3,31}$');

create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    public.profile_username_for_user(
      new.id,
      new.email,
      new.raw_user_meta_data->>'username'
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row
  execute function public.handle_new_user_profile();

with auth_usernames as (
  select
    auth_users.id,
    public.normalize_profile_username(
      auth_users.raw_user_meta_data->>'username',
      auth_users.email
    ) as base_username
  from auth.users as auth_users
  where not exists (
    select 1
    from public.profiles
    where profiles.id = auth_users.id
  )
),
numbered_usernames as (
  select
    id,
    case
      when length(base_username) < 3 then 'user'
      else base_username
    end as base_username,
    row_number() over (partition by base_username order by id) as username_number
  from auth_usernames
)
insert into public.profiles (id, username)
select
  id,
  case
    when username_number = 1
      and not exists (
        select 1
        from public.profiles
        where lower(profiles.username) = lower(numbered_usernames.base_username)
      )
      then numbered_usernames.base_username
    else left(numbered_usernames.base_username, 23) || replace(left(id::text, 8), '-', '')
  end as username
from numbered_usernames;
