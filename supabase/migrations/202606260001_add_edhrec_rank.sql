alter table public.card_search
add column if not exists edhrec_rank integer;

alter table public.card_variants
add column if not exists edhrec_rank integer;

create index if not exists card_search_edhrec_rank_idx
on public.card_search (edhrec_rank)
where edhrec_rank is not null;

create index if not exists card_variants_edhrec_rank_idx
on public.card_variants (edhrec_rank)
where edhrec_rank is not null;
