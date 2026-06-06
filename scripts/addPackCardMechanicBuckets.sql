alter table public.pack_cards
  add column if not exists manual_mechanic_bucket text;

alter table public.pack_cards
  drop constraint if exists pack_cards_manual_mechanic_bucket_valid;

alter table public.pack_cards
  add constraint pack_cards_manual_mechanic_bucket_valid
  check (
    manual_mechanic_bucket is null
    or manual_mechanic_bucket in (
      'synergy',
      'interaction',
      'card-draw',
      'ramp',
      'protection',
      'utility',
      'land'
    )
  );
