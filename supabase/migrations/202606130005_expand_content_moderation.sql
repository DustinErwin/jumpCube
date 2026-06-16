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
  words as (
    select word
    from normalized,
    unnest(string_to_array(text_value, ' ')) as word
  ),
  blocked_words(term) as (
    values
      ('asshole'), ('bastard'), ('bitch'), ('cunt'), ('dickhead'),
      ('fuck'), ('motherfucker'), ('shit'), ('whore'), ('chink'),
      ('coon'), ('cracker'), ('dyke'), ('fag'), ('faggot'), ('gook'),
      ('homo'), ('jap'), ('kike'), ('nigga'), ('nigger'), ('paki'),
      ('retard'), ('shemale'), ('spic'), ('tranny'), ('wetback')
  ),
  blocked_phrases(term) as (
    values
      ('white power'), ('heil hitler'), ('gas the jews'),
      ('kill all jews'), ('kill all gays'), ('kill all blacks'),
      ('kill all muslims'), ('kill all trans')
  ),
  separated_letter_runs(candidate) as (
    select regexp_replace(match[1], ' ', '', 'g')
    from normalized,
    lateral regexp_matches(
      ' ' || text_value || ' ',
      ' (([a-z] ){2,11}[a-z]) ',
      'g'
    ) as match
  )
  select
    exists (
      select 1
      from blocked_phrases, normalized
      where (' ' || text_value || ' ') like ('% ' || term || ' %')
    )
    or exists (
      select 1
      from blocked_words
      join (
        select word as candidate from words
        union all
        select candidate from separated_letter_runs
      ) candidates on
        candidates.candidate ~ ('^' || term || '(s|es|ed|ing|er|ers|y)?$')
        or regexp_replace(candidates.candidate, '([a-z])\1+', '\1', 'g')
          ~ ('^' || term || '(s|es|ed|ing|er|ers|y)?$')
    );
$$;
