create or replace function public.contains_blocked_community_text(value text)
returns boolean
language sql
immutable
as $$
  with normalized as (
    select trim(regexp_replace(
      translate(lower(coalesce(value, '')), '0134578', 'oieastb'),
      '[^a-z]+',
      ' ',
      'g'
    )) as text_value
  ),
  blocked(term) as (
    values
      ('asshole'), ('bastard'), ('bitch'), ('cunt'), ('dickhead'),
      ('fuck'), ('motherfucker'), ('shit'), ('whore'), ('chink'),
      ('faggot'), ('kike'), ('nigger'), ('retard'), ('spic'),
      ('tranny'), ('wetback'), ('white power'), ('heil hitler')
  )
  select exists (
    select 1
    from normalized, blocked
    where (' ' || text_value || ' ') like ('% ' || term || ' %')
       or (
         position(' ' in term) = 0
         and exists (
           select 1
           from unnest(string_to_array(text_value, ' ')) as word
           where word ~ ('^' || term || '(s|es|ed|ing|er|ers|y)?$')
         )
       )
  );
$$;

create or replace function public.reject_blocked_community_text()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'profiles' then
    if public.contains_blocked_community_text(new.username) then
      raise exception 'Community text contains blocked language'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'tags' then
    if public.contains_blocked_community_text(new.name) then
      raise exception 'Community text contains blocked language'
        using errcode = '23514';
    end if;
  else
    if public.contains_blocked_community_text(new.name)
      or public.contains_blocked_community_text(new.description) then
      raise exception 'Community text contains blocked language'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists moderate_profiles_text on public.profiles;
create trigger moderate_profiles_text
before insert or update of username on public.profiles
for each row execute function public.reject_blocked_community_text();

drop trigger if exists moderate_packs_text on public.packs;
create trigger moderate_packs_text
before insert or update of name, description on public.packs
for each row execute function public.reject_blocked_community_text();

drop trigger if exists moderate_cubes_text on public.cubes;
create trigger moderate_cubes_text
before insert or update of name, description on public.cubes
for each row execute function public.reject_blocked_community_text();

drop trigger if exists moderate_tags_text on public.tags;
create trigger moderate_tags_text
before insert or update of name on public.tags
for each row execute function public.reject_blocked_community_text();
