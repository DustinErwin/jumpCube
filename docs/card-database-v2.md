# Card Database V2 Plan

This document is the working map for rebuilding the card database/search layer
without losing sight of the moving parts. Update it as decisions are made and
check items off as they land.

## Why We Are Rebuilding

The current `cards` table is doing too many jobs at once:

- Stores every imported Scryfall row/printing.
- Acts as the main search table.
- Stores normalized fields added after the first import.
- Stores default-printing flags that have drifted over time.
- Supports card modal version selection.
- Supports pack card references.

That overlap has caused drift:

- Duplicate `is_default_printing` rows for the same `oracle_id`.
- Default printings not always matching debut set + lowest collector number.
- Foil/nonfoil rows sometimes causing search exclusions.
- Search-specific flags and normalized fields needing repeated backfills.
- Text searches timing out because Oracle text is interpreted during search.

The V2 goal is to separate **card identity/search** from **printings/variants**.
Scryfall's bulk feeds already line up with that split:

- `oracle_cards`: one card object per Oracle ID; use this to populate
  `card_search`.
- `all_cards`: every Scryfall card object; use this to populate
  `card_variants`.
- `oracle_tags`: optional Tagger rule/function metadata; use this to populate
  `oracle_tag_definitions` and `card_oracle_tags`, but do not make core search
  behavior depend on it.

## Target Architecture

### `card_variants`

One row per Scryfall printing/variant.

Used for:

- Card modal version picker.
- Exact printing image/price/set data.
- Future "show all printings" behavior.
- Preserving the Scryfall printing history without polluting search.

Core columns:

```sql
id uuid primary key
scryfall_id uuid unique not null
oracle_id uuid not null
set_code text
set_name text
collector_number text
released_at date
rarity text
image_url text
back_image_url text
image_uris jsonb
card_faces jsonb
is_token boolean
layout text
price_usd numeric
price_usd_foil numeric
created_at timestamptz
updated_at timestamptz
```

Important rules:

- Upsert by `scryfall_id`.
- Import from Scryfall's `all_cards` bulk feed.
- Do not use this table directly for the normal search grid.
- Do not treat this table as the rebuild source for `card_search`.
- Keep this table focused on printing/version display, selected variant
  references, images, prices, finish data, and set/collector metadata.
- All gameplay/search/stat logic should use `card_search` by `oracle_id`.

### `oracle_tag_definitions`

One row per Scryfall Tagger Oracle tag.

Used for:

- Preserving tag metadata from the `oracle_tags` bulk feed.
- Displaying readable tag names/descriptions later if useful.
- Tracking tag hierarchy through parent/child IDs without flattening away
  useful context.

Core columns:

```sql
id uuid primary key
slug text unique not null
label text not null
tag_type text default 'oracle'
uri text
description text
parent_ids uuid[]
child_ids uuid[]
aliases text[]
updated_at timestamptz
```

Important rules:

- Upsert by Scryfall tag `id`.
- Keep `slug` as the stable human-readable/searchable tag key.
- The Scryfall bulk row contains nested `taggings`; those should be expanded
  into `card_oracle_tags`.

### `card_oracle_tags`

One row per Scryfall Tagger Oracle tag assignment.

Used for:

- Importing Scryfall's `oracle_tags` bulk data.
- Joining community/function tags to cards by `oracle_id`.
- Supporting tag search/filtering without live Scryfall tag queries.

Core columns:

```sql
oracle_id uuid not null
tag_id uuid references oracle_tag_definitions(id)
tag_slug text not null
weight text
tag_source text default 'scryfall_tagger'
updated_at timestamptz
primary key (oracle_id, tag_id)
```

Important rules:

- Expand each `oracle_tags` bulk row's nested `taggings` array into this table.
- Join to `card_search` by `oracle_id`.
- Join to `oracle_tag_definitions` by `tag_id` when label, description, aliases,
  or hierarchy are needed.
- Keep imported tags separate from app-curated tags so we can tell where a tag
  came from.

Source row shape:

```json
{
  "object": "tag",
  "id": "001b5d5f-2ce6-4377-9f51-a8dfd91835ae",
  "label": "cycle-cmr-artifact-partner",
  "slug": "cycle-cmr-artifact-partner",
  "type": "oracle",
  "description": null,
  "parent_ids": ["1adda1a4-e23d-4212-a4da-58303a20e00c"],
  "child_ids": [],
  "aliases": [],
  "taggings": [
    {
      "oracle_id": "ccad9b56-3c31-445f-8b78-b5bbdb3d077a",
      "weight": "median"
    }
  ]
}
```

### `card_search`

One row per card identity, generally one row per `oracle_id`.

Used for:

- Main card search grid.
- Filters and counts.
- Fast pagination.
- Default image/display data.
- Pack/cube default display when no exact variant is selected.

Core columns:

```sql
id uuid primary key
oracle_id uuid unique not null
default_variant_id uuid references card_variants(id)
name text not null
normalized_name text
type_line text
normalized_type_line text
oracle_text text
normalized_oracle_text text
search_text text
mana_cost text
mana_value numeric
power numeric
toughness numeric
color_identity text[]
produces_colors text[]
rarity text
artist text
legalities jsonb
image_url text
back_image_url text
image_uris jsonb
card_faces jsonb
set_code text
set_name text
collector_number text
released_at date
is_artifact boolean
is_battle boolean
is_creature boolean
is_enchantment boolean
is_instant boolean
is_land boolean
is_planeswalker boolean
is_sorcery boolean
is_token boolean
is_funny boolean
is_planechase boolean
created_at timestamptz
updated_at timestamptz
```

Important rules:

- Import from Scryfall's `oracle_cards` bulk feed.
- `default_variant_id` should point to the matching row in `card_variants` when
  that variant exists in `all_cards`.
- `card_search` should be rebuilt from `oracle_cards`, not calculated from
  `card_variants`.
- The app should search this table, not `card_variants`.
- Scryfall describes `oracle_cards` as choosing recognizable, up-to-date
  versions. If we accept that choice, we do not need our own default-printing
  algorithm or a `sets` table.
- Do not store the full imported tag list on `card_search`; there can be too
  many tags per card. Promote only small, curated tag-derived fields into
  `card_search` if they become first-class filters.

## Search Behavior

### Normal Search

Normal text search should feel forgiving.

Examples:

```text
jace mind sculptor
enters battlefield land
green blue land
sacrifice draw
```

Normal search should use `search_text`, which includes:

- name
- type line
- Oracle text
- back-face name/type/oracle text when applicable
- keywords if useful

### Pointed Syntax

Pointed syntax should be precise and map to specific indexed columns.

Examples:

```text
name:"Jace, the Mind Sculptor"
oracle:"draw a card"
type:land
set:zen
mv:2
tag:etb
```

This avoids guessing whether a quoted phrase is a card title or Oracle text.

## Land Color Filtering

For normal cards, color filters use `color_identity`.

For lands, selected colors mean "this land can produce all selected colors."

Examples:

- `Land + G`: produces green or any color.
- `Land + G + U`: produces green and blue, or any color.
- `Land + W + U + B`: produces all three, or any color.
- `Land + C + G`: produces colorless and green. "Any color" does not cover `C`.

This should use `produces_colors`, not live Oracle-text parsing.

```sql
is_land = true
and produces_colors @> array['G', 'U']
```

## Rule Tags

Rule tags are factual/function tags tied to what a card does. They are
different from broad mechanic buckets like `Interaction` or `Ramp`.

Important caution:

- Do not rely on Scryfall Tagger data as the only source of truth for important
  app behavior. Tags are community-maintained metadata and may be incomplete,
  too broad, too narrow, or named differently than our users expect.
- Core card search should keep working from normalized Scryfall card fields:
  name, type line, Oracle text, color identity, legalities, mana value, and
  derived booleans such as `is_creature` or `is_land`.
- Any pack-building template, mechanic bucket, or high-value filter should be
  backed by app-owned deterministic rules first. Imported tags can supplement
  those rules or help us discover candidates.

Primary source:

- App-owned parsing and curated rules derived from Oracle text/type data.

Optional app source:

- Scryfall's `oracle_tags` bulk data from Tagger, used as advisory metadata.

Initial tags to consider:

```text
etb
dies
attacks
blocks
combat_damage
casts_spell
draws_card
discards_card
sacrifices
creates_token
counters_spell
mills
lifegain
landfall
graveyard
artifact_synergy
creature_synergy
```

Examples:

- "enters the battlefield", "enters" -> `etb`
- "dies" -> `dies`
- "whenever ... attacks" -> `attacks`
- "create a ... token" -> `creates_token`

Import detail:

- Store tag metadata in `oracle_tag_definitions`.
- Store expanded card/tag assignments in `card_oracle_tags`.
- Query tags through `card_oracle_tags` when the user explicitly searches or
  filters by tag.
- Keep `card_search` lean. Only add tag-derived columns there for a small
  curated set of high-value filters that need to be extremely fast.
- If we add app-curated tags, keep their source distinguishable.

Query strategy:

- Normal card search should not join tag tables by default.
- Explicit `tag:` searches should join `card_oracle_tags` by `oracle_id`.
- Tag autocomplete or browse UI should query `oracle_tag_definitions`.
- If a tag becomes a core filter used constantly, promote it into a dedicated
  boolean or small enum/array on `card_search` only after we define the
  app-owned rule for that filter.

## Derived Mechanic Buckets

Mechanic buckets are interpretive labels used for pack-building/stat views. Do
not store these on `card_search` for V2. Derive them in application code from
card type, curated rules, and selected tag lookups when needed.

Current buckets:

```text
Synergy
Interaction
Card Draw
Ramp
Protection
Utility
Land
```

Do not confuse:

- tag assignments: factual text patterns imported from Scryfall Tagger.
- mechanic buckets: app interpretation for pack construction.

## Index Plan

### `card_search`

Likely indexes:

```sql
create unique index on card_search (oracle_id);
create index on card_search (name);
create index on card_search (mana_value);
create index on card_search (rarity);
create index on card_search using gin (color_identity);
create index on card_search using gin (produces_colors);
create index on card_search using gin (search_text gin_trgm_ops);
create index on card_search using gin (normalized_name gin_trgm_ops);
```

Partial indexes may be useful for common default search scope:

```sql
where is_token = false
  and is_funny = false
  and is_planechase = false
```

### `card_variants`

Likely indexes:

```sql
create unique index on card_variants (scryfall_id);
create index on card_variants (oracle_id);
create index on card_variants (set_code);
create index on card_variants (released_at);
create index on card_variants (oracle_id, released_at, collector_number);
```

### `oracle_tag_definitions`

Likely indexes:

```sql
create unique index on oracle_tag_definitions (slug);
create index on oracle_tag_definitions using gin (aliases);
```

### `card_oracle_tags`

Likely indexes:

```sql
create unique index on card_oracle_tags (oracle_id, tag_id);
create index on card_oracle_tags (tag_slug);
create index on card_oracle_tags (oracle_id);
```

## Pack/Cube Data Model

Current packs likely reference `cards.id`.

V2 should support card identity plus optional exact printing:

```sql
pack_cards.card_id        -- references card_search(id)
pack_cards.variant_id     -- nullable, references card_variants(id)
pack_cards.quantity
pack_cards.manual_mechanic_bucket
```

Behavior:

- If `variant_id` is null, display `card_search.default_variant_id`.
- If user selects a specific version in the modal, store `variant_id`.
- Pack/cube stats use `card_search`.
- Card image can come from selected variant or default variant.

Migration concern:

- Existing `pack_cards.card_id` must be mapped from old `cards` rows to new
  `card_search` rows, preferably by `oracle_id`.
- If an old row lacks `oracle_id`, use `scryfall_id` to find its variant, then
  map variant to `oracle_id`.

## Import Pipeline

Preferred automatic update flow:

1. Scheduled GitHub Action runs nightly.
2. Fetch Scryfall bulk metadata.
3. Compare bulk id/updated timestamp against last successful import.
4. If unchanged, stop.
5. Download `oracle_cards`, `all_cards`, and `oracle_tags`.
6. Upsert `all_cards` into `card_variants` by `scryfall_id`.
7. Upsert `oracle_tags` into `oracle_tag_definitions` and expanded
   `card_oracle_tags`.
8. Rebuild/refresh `card_search` from `oracle_cards`.
9. Link `card_search.default_variant_id` to the matching `card_variants` row.
10. Optionally compute any small promoted tag-derived fields we explicitly
    choose later.
11. Validate known test cases.
12. Analyze tables.
13. Record import run status.

Track imports in:

```sql
card_import_runs
```

Possible columns:

```sql
id uuid primary key
started_at timestamptz
finished_at timestamptz
status text
scryfall_bulk_id text
scryfall_updated_at timestamptz
variant_rows_upserted integer
search_rows_rebuilt integer
oracle_tag_rows_upserted integer
oracle_tagging_rows_upserted integer
error_message text
```

## Validation Cases

Before switching the app to V2, these should pass:

- `Vivid Grove` appears for `Land + G + U`.
- `Jace, the Mind Sculptor` appears for `jace mind sculptor`.
- `"enters the battlefield"` or `etb` returns expected ETB cards.
- `Standard + bird` roughly matches Scryfall expectations.
- `Basic Land` filter returns exactly the six basics.
- `Land + sacrifice` includes `Terramorphic Expanse` and `Evolving Wilds`.
- Double-faced cards have correct front/back images and flip behavior.
- Version picker can select a non-default variant.
- Existing packs still load after migration.

## Build Phases

### Phase 1: Design Lock

- [ ] Finalize `card_variants` columns.
- [ ] Finalize `oracle_tag_definitions` columns.
- [ ] Finalize `card_oracle_tags` columns.
- [ ] Finalize `card_search` columns.
- [ ] Decide whether to keep `raw`.
- [ ] Decide pack reference migration shape.
- [ ] Decide which imported Scryfall `oracle_tags` need aliases or local
      app-specific additions.
- [ ] Decide import schedule owner: GitHub Actions vs Supabase.

### Phase 2: New Tables

- [ ] Create `card_variants`.
- [ ] Create `oracle_tag_definitions`.
- [ ] Create `card_oracle_tags`.
- [ ] Create `card_search`.
- [ ] Add indexes.
- [ ] Add import run tracking table.
- [ ] Keep old `cards` table untouched.

### Phase 3: Import/Build

- [ ] Update importer to download Scryfall bulk metadata.
- [ ] Update importer to download `oracle_cards`.
- [ ] Update importer to download `all_cards`.
- [ ] Update importer to download `oracle_tags`.
- [ ] Update importer to populate `oracle_tag_definitions`.
- [ ] Update importer to populate `card_oracle_tags`.
- [ ] Update importer to populate `card_variants`.
- [ ] Add builder to populate `card_search` from `oracle_cards`.
- [ ] Compute `produces_colors`.
- [ ] Compute type booleans.
- [ ] Compute `search_text`.
- [ ] Link `default_variant_id` to the matching variant.
- [ ] Decide whether any tag-derived fields should be promoted into
      `card_search`.

### Phase 4: Validation

- [ ] Run validation SQL.
- [ ] Fix mismatches.
- [ ] Confirm Vivid Grove.
- [ ] Confirm ETB search.
- [ ] Confirm basic lands.
- [ ] Confirm version picker data.

### Phase 5: UI Switch

- [ ] Update search hook to query `card_search`.
- [ ] Update modal variant loading from `card_variants`.
- [ ] Update pack cards to support `variant_id`.
- [ ] Update pack/cube stats to use `card_search`.
- [ ] Remove old RPC complexity if no longer needed.

### Phase 6: Migration

- [ ] Map existing `pack_cards.card_id` to new `card_search.id`.
- [ ] Preserve selected variant where possible.
- [ ] Keep old `cards` table as rollback.
- [ ] Smoke test user packs/cubes.

### Phase 7: Cleanup

- [ ] Remove obsolete cleanup scripts.
- [ ] Remove old search indexes/RPCs.
- [ ] Archive or drop old `cards` table after confidence period.
- [ ] Document automatic import process.

## Open Decisions

- [ ] Should `raw` be retained in `card_variants`, or only in import logs?
- [ ] Should pack cards require `variant_id`, or keep it optional?
- [ ] Should descriptions stay single-line or allow newlines?
- [ ] Which imported `oracle_tags` should be exposed in V1?
- [ ] Do any Scryfall `oracle_tags` need app-specific aliases?
- [ ] Should normal search use trigram `search_text`, full-text search, or both?
- [ ] Should total result counts be exact, approximate, or optional?
- [ ] How often should Scryfall imports run?
- [ ] Do we accept Scryfall's `oracle_cards` representative printing as the
      default, or do we still need a custom "debut set + lowest collector
      number" default?

## Notes

- Avoid deleting/replacing the old `cards` table until pack migration is tested.
- Avoid making search depend on live parsing of Oracle text where a normalized
  column can answer the question.
- Prefer rebuildable derived data over manual cleanup scripts.
- Every derived field should have a clear source and rebuild function.
