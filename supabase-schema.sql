-- Graduation invitation tables for a shared Supabase project.
-- These names are intentionally prefixed with "graduation_" so this can live
-- beside another app such as Arbolito without table or policy collisions.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

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
  note_color text not null default 'pastel-yellow' check (note_color in ('pastel-yellow', 'pastel-blue', 'pastel-mint', 'pastel-pink', 'pastel-peach')),
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.graduation_messages
add column if not exists note_color text not null default 'pastel-yellow';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'graduation_messages_note_color_check'
  ) then
    alter table public.graduation_messages
    add constraint graduation_messages_note_color_check
    check (note_color in ('pastel-yellow', 'pastel-blue', 'pastel-mint', 'pastel-pink', 'pastel-peach'));
  end if;
end $$;

create table if not exists public.graduation_memories (
  id uuid primary key default gen_random_uuid(),
  owner_token text not null check (char_length(owner_token) between 16 and 128),
  image_data text not null check (
    char_length(image_data) between 32 and 2200000
    and image_data ~ '^data:image/(jpeg|png|webp);base64,'
  ),
  caption text check (caption is null or char_length(caption) <= 100),
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
values (true, extensions.crypt('cats', extensions.gen_salt('bf')))
on conflict (id) do update
set password_hash = excluded.password_hash,
    updated_at = now();

alter table public.graduation_rsvps enable row level security;
alter table public.graduation_messages enable row level security;
alter table public.graduation_memories enable row level security;
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
with check (
  is_hidden = false
  and note_color in ('pastel-yellow', 'pastel-blue', 'pastel-mint', 'pastel-pink', 'pastel-peach')
);

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
grant insert, select on public.graduation_messages to anon;
grant select on public.graduation_site_settings to anon;
revoke all on public.graduation_rsvps from anon, authenticated;
revoke all on public.graduation_memories from anon, authenticated;

create or replace function public.graduation_assert_admin(admin_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  stored_hash text;
begin
  select password_hash into stored_hash
  from public.graduation_admin_config
  where id = true;

  if stored_hash is null or stored_hash <> extensions.crypt(coalesce(admin_password, ''), stored_hash) then
    raise exception 'Invalid graduation admin password';
  end if;
end;
$$;

create or replace function public.graduation_save_rsvp(
  p_guest_key text,
  p_guest_name text,
  p_party_count integer,
  p_response text,
  p_contact text default '',
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(trim(p_guest_key), '') = '' or coalesce(trim(p_guest_name), '') = '' then
    raise exception 'Missing RSVP name';
  end if;

  if p_response not in ('yes', 'maybe', 'no') then
    raise exception 'Invalid RSVP response';
  end if;

  insert into public.graduation_rsvps (
    guest_key,
    guest_name,
    party_count,
    response,
    contact,
    note,
    updated_at
  )
  values (
    trim(p_guest_key),
    trim(p_guest_name),
    least(greatest(coalesce(p_party_count, 1), 1), 20),
    p_response,
    nullif(trim(coalesce(p_contact, '')), ''),
    nullif(trim(coalesce(p_note, '')), ''),
    now()
  )
  on conflict (guest_key) do update
  set guest_name = excluded.guest_name,
      party_count = excluded.party_count,
      response = excluded.response,
      contact = excluded.contact,
      note = excluded.note,
      updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.graduation_public_memories()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(to_jsonb(m) order by m.created_at desc),
    '[]'::jsonb
  )
  from (
    select id, image_data, caption, created_at
    from public.graduation_memories
    where is_hidden = false
    order by created_at desc
    limit 60
  ) m;
$$;

create or replace function public.graduation_add_memory(
  p_owner_token text,
  p_image_data text,
  p_caption text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if char_length(coalesce(p_owner_token, '')) < 16 then
    raise exception 'Missing memory owner token';
  end if;

  if coalesce(p_image_data, '') !~ '^data:image/(jpeg|png|webp);base64,' or char_length(p_image_data) > 2200000 then
    raise exception 'Memory image is too large or unsupported';
  end if;

  insert into public.graduation_memories (owner_token, image_data, caption)
  values (p_owner_token, p_image_data, nullif(left(trim(coalesce(p_caption, '')), 100), ''))
  returning jsonb_build_object(
    'id', id,
    'image_data', image_data,
    'caption', caption,
    'created_at', created_at
  )
  into result;

  return result;
end;
$$;

create or replace function public.graduation_delete_memory(
  p_owner_token text,
  memory_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.graduation_memories
  where id = memory_id
    and owner_token = p_owner_token;

  get diagnostics deleted_count = row_count;
  return jsonb_build_object('ok', deleted_count > 0);
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
          select id, body, note_color, is_hidden, created_at
          from public.graduation_messages
          order by created_at desc
        ) m
      ),
      '[]'::jsonb
    ),
    'memories', coalesce(
      (
        select jsonb_agg(to_jsonb(mem) order by mem.created_at desc)
        from (
          select id, image_data, caption, is_hidden, created_at
          from public.graduation_memories
          order by created_at desc
          limit 100
        ) mem
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

create or replace function public.graduation_admin_delete_rsvp(admin_password text, rsvp_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.graduation_assert_admin(admin_password);

  delete from public.graduation_rsvps
  where id = rsvp_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.graduation_admin_delete_memory(admin_password text, memory_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.graduation_assert_admin(admin_password);

  delete from public.graduation_memories
  where id = memory_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.graduation_save_rsvp(text, text, integer, text, text, text) to anon;
grant execute on function public.graduation_public_memories() to anon;
grant execute on function public.graduation_add_memory(text, text, text) to anon;
grant execute on function public.graduation_delete_memory(text, uuid) to anon;
grant execute on function public.graduation_admin_list(text) to anon;
grant execute on function public.graduation_admin_save_settings(text, jsonb) to anon;
grant execute on function public.graduation_admin_delete_message(text, uuid) to anon;
grant execute on function public.graduation_admin_delete_rsvp(text, uuid) to anon;
grant execute on function public.graduation_admin_delete_memory(text, uuid) to anon;

notify pgrst, 'reload schema';

-- Privacy note:
-- Do not add a public SELECT policy to graduation_rsvps if you want guest names,
-- contact info, and private notes to stay private. The password-protected RPC
-- functions above are used for the admin dashboard.
