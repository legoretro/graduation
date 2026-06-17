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

create table if not exists public.graduation_site_settings (
  setting_key text primary key,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.graduation_admin_config (
  id boolean primary key default true check (id = true),
  password_hash text not null,
  updated_at timestamptz not null default now()
);

insert into public.graduation_admin_config (id, password_hash)
values (true, crypt('cats', gen_salt('bf')))
on conflict (id) do nothing;

alter table public.graduation_rsvps enable row level security;
alter table public.graduation_messages enable row level security;
alter table public.graduation_site_settings enable row level security;
alter table public.graduation_admin_config enable row level security;

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

drop policy if exists "graduation guests read site settings" on public.graduation_site_settings;
create policy "graduation guests read site settings"
on public.graduation_site_settings
for select
to anon
using (setting_key = 'site');

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
grant select on public.graduation_site_settings to anon;

create or replace function public.graduation_assert_admin(admin_password text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  stored_hash text;
begin
  select password_hash into stored_hash
  from public.graduation_admin_config
  where id = true;

  if stored_hash is null or stored_hash <> crypt(coalesce(admin_password, ''), stored_hash) then
    raise exception 'Invalid graduation admin password';
  end if;
end;
$$;

create or replace function public.graduation_admin_list(admin_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.graduation_assert_admin(admin_password);

  return jsonb_build_object(
    'rsvps', coalesce(
      (
        select jsonb_agg(to_jsonb(r) order by r.updated_at desc)
        from (
          select id, guest_key, guest_name, party_count, response, contact, note, created_at, updated_at
          from public.graduation_rsvps
          order by updated_at desc
        ) r
      ),
      '[]'::jsonb
    ),
    'messages', coalesce(
      (
        select jsonb_agg(to_jsonb(m) order by m.created_at desc)
        from (
          select id, body, is_hidden, created_at
          from public.graduation_messages
          order by created_at desc
        ) m
      ),
      '[]'::jsonb
    ),
    'settings', coalesce(
      (
        select settings
        from public.graduation_site_settings
        where setting_key = 'site'
      ),
      '{}'::jsonb
    )
  );
end;
$$;

create or replace function public.graduation_admin_save_settings(admin_password text, new_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.graduation_assert_admin(admin_password);

  insert into public.graduation_site_settings (setting_key, settings, updated_at)
  values ('site', coalesce(new_settings, '{}'::jsonb), now())
  on conflict (setting_key) do update
  set settings = excluded.settings,
      updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.graduation_admin_delete_message(admin_password text, message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.graduation_assert_admin(admin_password);

  delete from public.graduation_messages
  where id = message_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.graduation_admin_list(text) to anon;
grant execute on function public.graduation_admin_save_settings(text, jsonb) to anon;
grant execute on function public.graduation_admin_delete_message(text, uuid) to anon;

-- Privacy note:
-- Do not add a public SELECT policy to graduation_rsvps if you want guest names,
-- contact info, and private notes to stay private. The password-protected RPC
-- functions above are used for the admin dashboard.
