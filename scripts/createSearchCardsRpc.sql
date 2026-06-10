-- Run this in the Supabase SQL editor to move the card search UI away from
-- long PostgREST filter URLs and into a predictable Postgres query.
--
-- The app calls public.search_cards(...) from src/hooks/useCards.js for normal
-- searches. Scryfall syntax searches still hydrate by oracle_id from cards.
--
-- This function intentionally builds dynamic SQL. That lets Postgres plan only
-- the filters the user actually selected instead of carrying every optional
-- filter as a giant OR expression.
--
-- Run scripts/addCardTypeFlags.sql before this file. The type flag columns are
-- regular booleans, not generated columns, so they can be backfilled in small
-- batches without timing out.

create or replace function public.card_produces_mana_colors(
  p_oracle_text text,
  p_colors text[],
  p_color_mode text default 'or'
)
returns boolean
language sql
immutable
as $$
  with requested_colors as (
    select unnest(coalesce(p_colors, array[]::text[])) as color_symbol
  ),
  mana_matches as (
    select
      color_symbol,
      case color_symbol
        when 'W' then coalesce(p_oracle_text, '') ilike '%{W}%'
        when 'U' then coalesce(p_oracle_text, '') ilike '%{U}%'
        when 'B' then coalesce(p_oracle_text, '') ilike '%{B}%'
        when 'R' then coalesce(p_oracle_text, '') ilike '%{R}%'
        when 'G' then coalesce(p_oracle_text, '') ilike '%{G}%'
        when 'C' then (
          coalesce(p_oracle_text, '') ilike '%{C}%'
          or coalesce(p_oracle_text, '') ilike '%colorless%'
        )
        else false
      end as produces_selected_color
    from requested_colors
  ),
  any_color_match as (
    select
      lower(coalesce(p_oracle_text, '')) like '%any color%'
      as produces_any_color
  )
  select case
    when not exists (select 1 from requested_colors) then true
    else not exists (
      select 1
      from mana_matches
      where produces_selected_color = false
        and not (
          (select produces_any_color from any_color_match)
          and color_symbol in ('W', 'U', 'B', 'R', 'G')
        )
    )
  end;
$$;

grant execute on function public.card_produces_mana_colors(
  text,
  text[],
  text
) to anon, authenticated;

create or replace function public.search_cards(
  p_any_search_terms text[] default array[]::text[],
  p_oracle_search_terms text[] default array[]::text[],
  p_mana_values numeric[] default array[]::numeric[],
  p_include_mana_7_plus boolean default false,
  p_colors text[] default array[]::text[],
  p_color_mode text default 'or',
  p_rarities text[] default array[]::text[],
  p_types text[] default array[]::text[],
  p_formats text[] default array[]::text[],
  p_selected_sets text[] default array[]::text[],
  p_show_all_printings boolean default false,
  p_limit integer default 50,
  p_offset integer default 0
)
returns setof public.cards
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_sql text := '
    select cards.*
    from public.cards
    where
      cards.games @> array[''paper'']::text[]
      and cards.nonfoil = true
      and cards.is_token = false
      and cards.is_funny = false
      and cards.is_planechase = false
      and coalesce(cards.layout, '''') <> ''art_series''
  ';
  v_any_search_terms text[] := coalesce(p_any_search_terms, array[]::text[]);
  v_oracle_search_terms text[] := coalesce(p_oracle_search_terms, array[]::text[]);
  v_mana_values numeric[] := coalesce(p_mana_values, array[]::numeric[]);
  v_colors text[] := coalesce(p_colors, array[]::text[]);
  v_color_mode text := lower(coalesce(p_color_mode, 'or'));
  v_rarities text[] := coalesce(p_rarities, array[]::text[]);
  v_types text[] := coalesce(p_types, array[]::text[]);
  v_formats text[] := coalesce(p_formats, array[]::text[]);
  v_selected_sets text[] := coalesce(p_selected_sets, array[]::text[]);
  v_show_all_printings boolean := coalesce(p_show_all_printings, false);
  v_include_mana_7_plus boolean := coalesce(p_include_mana_7_plus, false);
  v_limit integer := greatest(coalesce(p_limit, 50), 0);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_selected_colors text[] := array_remove(coalesce(p_colors, array[]::text[]), 'C');
  v_includes_colorless boolean := 'C' = any(coalesce(p_colors, array[]::text[]));
  v_includes_basic_land boolean := 'Basic Land' = any(coalesce(p_types, array[]::text[]));
  v_includes_land boolean :=
    'Land' = any(coalesce(p_types, array[]::text[]))
    or 'Basic Land' = any(coalesce(p_types, array[]::text[]));
  v_non_basic_types text[] := array_remove(coalesce(p_types, array[]::text[]), 'Basic Land');
  v_term text;
  v_type text;
  v_format text;
begin
  if cardinality(v_selected_sets) > 0 then
    v_sql := v_sql || format(' and cards.set_code = any(%L::text[])', v_selected_sets);
  end if;

  if not v_show_all_printings and cardinality(v_selected_sets) > 0 then
    v_sql := v_sql || ' and cards.is_variant_printing = false';
  end if;

  if not v_show_all_printings
    and cardinality(v_selected_sets) = 0
    and not v_includes_basic_land then
    v_sql := v_sql || ' and cards.is_default_printing = true';
  end if;

  foreach v_term in array v_any_search_terms loop
    v_sql := v_sql || format(
      ' and (
          cards.name ilike %L
          or cards.type_line ilike %L
          or cards.oracle_text ilike %L
        )',
      '%' || v_term || '%',
      '%' || v_term || '%',
      '%' || v_term || '%'
    );
  end loop;

  foreach v_term in array v_oracle_search_terms loop
    v_sql := v_sql || format(
      ' and cards.oracle_text ilike %L',
      '%' || v_term || '%'
    );
  end loop;

  if cardinality(v_rarities) > 0 then
    v_sql := v_sql || format(' and lower(cards.rarity) = any(%L::text[])', v_rarities);
  end if;

  if cardinality(v_mana_values) > 0 and v_include_mana_7_plus then
    v_sql := v_sql || format(
      ' and (cards.mana_value = any(%L::numeric[]) or cards.mana_value >= 7)',
      v_mana_values
    );
  elsif cardinality(v_mana_values) > 0 then
    v_sql := v_sql || format(' and cards.mana_value = any(%L::numeric[])', v_mana_values);
  elsif v_include_mana_7_plus then
    v_sql := v_sql || ' and cards.mana_value >= 7';
  end if;

  if v_includes_basic_land then
    v_sql := v_sql || ' and cards.name = any(array[
      ''Plains'',
      ''Island'',
      ''Swamp'',
      ''Mountain'',
      ''Forest'',
      ''Wastes''
    ])';
  end if;

  foreach v_type in array v_non_basic_types loop
    case v_type
      when 'Artifact' then
        v_sql := v_sql || ' and cards.is_artifact_type = true';
      when 'Battle' then
        v_sql := v_sql || ' and cards.is_battle_type = true';
      when 'Creature' then
        v_sql := v_sql || ' and cards.is_creature_type = true';
      when 'Enchantment' then
        v_sql := v_sql || ' and cards.is_enchantment_type = true';
      when 'Instant' then
        v_sql := v_sql || ' and cards.is_instant_type = true';
      when 'Land' then
        v_sql := v_sql || ' and cards.is_land_type = true';
      when 'Planeswalker' then
        v_sql := v_sql || ' and cards.is_planeswalker_type = true';
      when 'Sorcery' then
        v_sql := v_sql || ' and cards.is_sorcery_type = true';
      else
        v_sql := v_sql || format(' and cards.type_line ilike %L', '%' || v_type || '%');
    end case;
  end loop;

  foreach v_format in array v_formats loop
    v_sql := v_sql || format(
      ' and cards.legalities->>%L = ''legal''',
      lower(v_format)
    );
  end loop;

  if cardinality(v_colors) > 0 then
    if v_includes_land then
      v_sql := v_sql || format(
        ' and public.card_produces_mana_colors(cards.oracle_text, %L::text[], %L)',
        v_colors,
        v_color_mode
      );
    elsif v_includes_colorless and cardinality(v_selected_colors) = 0 then
      v_sql := v_sql || ' and cards.color_identity = array[]::text[]';
    elsif v_includes_colorless and cardinality(v_selected_colors) > 0 and v_color_mode = 'and' then
      v_sql := v_sql || ' and cards.color_identity = array[]::text[]';
    elsif v_includes_colorless and cardinality(v_selected_colors) > 0 then
      v_sql := v_sql || format(
        ' and (cards.color_identity = array[]::text[] or cards.color_identity && %L::text[])',
        v_selected_colors
      );
    elsif v_color_mode = 'and' then
      v_sql := v_sql || format(' and cards.color_identity @> %L::text[]', v_selected_colors);
    else
      v_sql := v_sql || format(' and cards.color_identity && %L::text[]', v_selected_colors);
    end if;
  end if;

  v_sql := v_sql || format(
    ' order by cards.name asc limit %s offset %s',
    v_limit,
    v_offset
  );

  return query execute v_sql;
end;
$$;

grant execute on function public.search_cards(
  text[],
  text[],
  numeric[],
  boolean,
  text[],
  text,
  text[],
  text[],
  text[],
  text[],
  boolean,
  integer,
  integer
) to anon, authenticated;

create or replace function public.count_search_cards(
  p_any_search_terms text[] default array[]::text[],
  p_oracle_search_terms text[] default array[]::text[],
  p_mana_values numeric[] default array[]::numeric[],
  p_include_mana_7_plus boolean default false,
  p_colors text[] default array[]::text[],
  p_color_mode text default 'or',
  p_rarities text[] default array[]::text[],
  p_types text[] default array[]::text[],
  p_formats text[] default array[]::text[],
  p_selected_sets text[] default array[]::text[],
  p_show_all_printings boolean default false,
  p_limit integer default 50,
  p_offset integer default 0
)
returns integer
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_sql text := '
    select count(*)::integer
    from public.cards
    where
      cards.games @> array[''paper'']::text[]
      and cards.nonfoil = true
      and cards.is_token = false
      and cards.is_funny = false
      and cards.is_planechase = false
      and coalesce(cards.layout, '''') <> ''art_series''
  ';
  v_any_search_terms text[] := coalesce(p_any_search_terms, array[]::text[]);
  v_oracle_search_terms text[] := coalesce(p_oracle_search_terms, array[]::text[]);
  v_mana_values numeric[] := coalesce(p_mana_values, array[]::numeric[]);
  v_colors text[] := coalesce(p_colors, array[]::text[]);
  v_color_mode text := lower(coalesce(p_color_mode, 'or'));
  v_rarities text[] := coalesce(p_rarities, array[]::text[]);
  v_types text[] := coalesce(p_types, array[]::text[]);
  v_formats text[] := coalesce(p_formats, array[]::text[]);
  v_selected_sets text[] := coalesce(p_selected_sets, array[]::text[]);
  v_show_all_printings boolean := coalesce(p_show_all_printings, false);
  v_include_mana_7_plus boolean := coalesce(p_include_mana_7_plus, false);
  v_selected_colors text[] := array_remove(coalesce(p_colors, array[]::text[]), 'C');
  v_includes_colorless boolean := 'C' = any(coalesce(p_colors, array[]::text[]));
  v_includes_basic_land boolean := 'Basic Land' = any(coalesce(p_types, array[]::text[]));
  v_includes_land boolean :=
    'Land' = any(coalesce(p_types, array[]::text[]))
    or 'Basic Land' = any(coalesce(p_types, array[]::text[]));
  v_non_basic_types text[] := array_remove(coalesce(p_types, array[]::text[]), 'Basic Land');
  v_term text;
  v_type text;
  v_format text;
  v_count integer;
begin
  if cardinality(v_selected_sets) > 0 then
    v_sql := v_sql || format(' and cards.set_code = any(%L::text[])', v_selected_sets);
  end if;

  if not v_show_all_printings and cardinality(v_selected_sets) > 0 then
    v_sql := v_sql || ' and cards.is_variant_printing = false';
  end if;

  if not v_show_all_printings
    and cardinality(v_selected_sets) = 0
    and not v_includes_basic_land then
    v_sql := v_sql || ' and cards.is_default_printing = true';
  end if;

  foreach v_term in array v_any_search_terms loop
    v_sql := v_sql || format(
      ' and (
          cards.name ilike %L
          or cards.type_line ilike %L
          or cards.oracle_text ilike %L
        )',
      '%' || v_term || '%',
      '%' || v_term || '%',
      '%' || v_term || '%'
    );
  end loop;

  foreach v_term in array v_oracle_search_terms loop
    v_sql := v_sql || format(
      ' and cards.oracle_text ilike %L',
      '%' || v_term || '%'
    );
  end loop;

  if cardinality(v_rarities) > 0 then
    v_sql := v_sql || format(' and lower(cards.rarity) = any(%L::text[])', v_rarities);
  end if;

  if cardinality(v_mana_values) > 0 and v_include_mana_7_plus then
    v_sql := v_sql || format(
      ' and (cards.mana_value = any(%L::numeric[]) or cards.mana_value >= 7)',
      v_mana_values
    );
  elsif cardinality(v_mana_values) > 0 then
    v_sql := v_sql || format(' and cards.mana_value = any(%L::numeric[])', v_mana_values);
  elsif v_include_mana_7_plus then
    v_sql := v_sql || ' and cards.mana_value >= 7';
  end if;

  if v_includes_basic_land then
    v_sql := v_sql || ' and cards.name = any(array[
      ''Plains'',
      ''Island'',
      ''Swamp'',
      ''Mountain'',
      ''Forest'',
      ''Wastes''
    ])';
  end if;

  foreach v_type in array v_non_basic_types loop
    case v_type
      when 'Artifact' then
        v_sql := v_sql || ' and cards.is_artifact_type = true';
      when 'Battle' then
        v_sql := v_sql || ' and cards.is_battle_type = true';
      when 'Creature' then
        v_sql := v_sql || ' and cards.is_creature_type = true';
      when 'Enchantment' then
        v_sql := v_sql || ' and cards.is_enchantment_type = true';
      when 'Instant' then
        v_sql := v_sql || ' and cards.is_instant_type = true';
      when 'Land' then
        v_sql := v_sql || ' and cards.is_land_type = true';
      when 'Planeswalker' then
        v_sql := v_sql || ' and cards.is_planeswalker_type = true';
      when 'Sorcery' then
        v_sql := v_sql || ' and cards.is_sorcery_type = true';
      else
        v_sql := v_sql || format(' and cards.type_line ilike %L', '%' || v_type || '%');
    end case;
  end loop;

  foreach v_format in array v_formats loop
    v_sql := v_sql || format(
      ' and cards.legalities->>%L = ''legal''',
      lower(v_format)
    );
  end loop;

  if cardinality(v_colors) > 0 then
    if v_includes_land then
      v_sql := v_sql || format(
        ' and public.card_produces_mana_colors(cards.oracle_text, %L::text[], %L)',
        v_colors,
        v_color_mode
      );
    elsif v_includes_colorless and cardinality(v_selected_colors) = 0 then
      v_sql := v_sql || ' and cards.color_identity = array[]::text[]';
    elsif v_includes_colorless and cardinality(v_selected_colors) > 0 and v_color_mode = 'and' then
      v_sql := v_sql || ' and cards.color_identity = array[]::text[]';
    elsif v_includes_colorless and cardinality(v_selected_colors) > 0 then
      v_sql := v_sql || format(
        ' and (cards.color_identity = array[]::text[] or cards.color_identity && %L::text[])',
        v_selected_colors
      );
    elsif v_color_mode = 'and' then
      v_sql := v_sql || format(' and cards.color_identity @> %L::text[]', v_selected_colors);
    else
      v_sql := v_sql || format(' and cards.color_identity && %L::text[]', v_selected_colors);
    end if;
  end if;

  execute v_sql into v_count;

  return v_count;
end;
$$;

grant execute on function public.count_search_cards(
  text[],
  text[],
  numeric[],
  boolean,
  text[],
  text,
  text[],
  text[],
  text[],
  text[],
  boolean,
  integer,
  integer
) to anon, authenticated;
