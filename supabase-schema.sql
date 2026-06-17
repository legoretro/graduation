-- Graduation invitation tables for a shared Supabase project.
-- These names are intentionally prefixed with "graduation_" so this can live
-- beside another app such as Arbolito without table or policy collisions.

create extension if not exists pgcrypto;

create table if not exists public.graduation_rsvps (
  id uuid primary key default gen_random_uuid(),
  guest_key text not null unique,
  guest_name text not null,
  party_count integer not null default 1 check (party_count between 1 and 20),
  response text not null check (response in ('yes', 'maybe', 'no')),
  contact text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.graduation_messages (
  id uuid primary key default gen_random_uuid(),
  body text not null check (char_length(body) between 1 and 220),
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.graduation_rsvps enable row level security;
alter table public.graduation_messages enable row level security;

drop policy if exists "graduation guests insert rsvps" on public.graduation_rsvps;
create policy "graduation guests insert rsvps"
on public.graduation_rsvps
for insert
to anon
with check (true);

drop policy if exists "graduation guests update rsvps" on public.graduation_rsvps;
create policy "graduation guests update rsvps"
on public.graduation_rsvps
for update
to anon
using (true)
with check (true);

drop policy if exists "graduation guests insert messages" on public.graduation_messages;
create policy "graduation guests insert messages"
on public.graduation_messages
for insert
to anon
with check (is_hidden = false);

drop policy if exists "graduation guests read visible messages" on public.graduation_messages;
create policy "graduation guests read visible messages"
on public.graduation_messages
for select
to anon
using (is_hidden = false);

create or replace view public.graduation_rsvp_totals as
select
  response,
  case
    when response = 'no' then count(*)::integer
    else coalesce(sum(party_count), 0)::integer
  end as total
from public.graduation_rsvps
group by response;

grant select on public.graduation_rsvp_totals to anon;
grant insert, update on public.graduation_rsvps to anon;
grant insert, select on public.graduation_messages to anon;

-- Privacy note:
-- Do not add a public SELECT policy to graduation_rsvps if you want guest names,
-- contact info, and private notes to stay private. Use the Edge Function in
-- supabase-admin-function.ts for the admin dashboard.
