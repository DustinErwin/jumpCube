alter table public.packs
add column if not exists visibility text not null default 'private';

alter table public.packs
drop constraint if exists packs_visibility_check;

alter table public.packs
add constraint packs_visibility_check
check (visibility in ('private', 'public'));

update public.packs
set visibility = 'private'
where visibility is null;
