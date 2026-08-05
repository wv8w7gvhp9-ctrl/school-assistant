-- Одноразовое подключение устройства ребёнка.
-- Код хранится только как SHA-256 хеш, действует 15 минут и становится недействительным после использования.

create extension if not exists pgcrypto with schema extensions;

create table public.child_link_codes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete cascade,
  check (expires_at > created_at)
);

create table public.child_devices (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  connected_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table public.child_link_codes enable row level security;
alter table public.child_devices enable row level security;

create policy "parents read devices of their family"
on public.child_devices for select to authenticated
using (exists (
  select 1 from public.family_members member
  where member.family_id = child_devices.family_id
    and member.user_id = auth.uid()
    and member.role = 'parent'
));

grant select on public.child_devices to authenticated;

create or replace function public.create_child_link_code()
returns table (display_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  own_family_id uuid;
  own_child_id uuid;
  raw_code text;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) then
    raise exception 'A parent session is required' using errcode = '42501';
  end if;

  select member.family_id, child.id into own_family_id, own_child_id
  from public.family_members member
  join public.children child on child.family_id = member.family_id
  where member.user_id = auth.uid() and member.role = 'parent'
  limit 1;

  if own_family_id is null then
    raise exception 'Family profile was not found' using errcode = 'P0002';
  end if;

  -- Отменяем все неиспользованные коды этой семьи перед выдачей следующего.
  update public.child_link_codes
  set expires_at = now()
  where family_id = own_family_id and used_at is null and expires_at > now();

  raw_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 12));
  insert into public.child_link_codes (family_id, child_id, code_hash, expires_at, created_by)
  values (
    own_family_id,
    own_child_id,
    encode(digest(raw_code, 'sha256'), 'hex'),
    now() + interval '15 minutes',
    auth.uid()
  );

  return query select substr(raw_code, 1, 4) || '-' || substr(raw_code, 5, 4) || '-' || substr(raw_code, 9, 4), now() + interval '15 minutes';
end;
$$;

create or replace function public.redeem_child_link_code(input_code text)
returns table (child_id uuid, child_name text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  requested_hash text := encode(digest(upper(replace(btrim(input_code), '-', '')), 'sha256'), 'hex');
  link_record public.child_link_codes%rowtype;
  connected_child_name text;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true then
    raise exception 'A child device session is required' using errcode = '42501';
  end if;

  if exists (select 1 from public.child_devices where auth_user_id = auth.uid() and revoked_at is null) then
    raise exception 'This device is already connected' using errcode = '23505';
  end if;

  select * into link_record
  from public.child_link_codes
  where code_hash = requested_hash
  for update;

  if not found or link_record.used_at is not null or link_record.expires_at <= now() then
    raise exception 'The code is invalid or expired' using errcode = '22023';
  end if;

  insert into public.child_devices (family_id, child_id, auth_user_id)
  values (link_record.family_id, link_record.child_id, auth.uid());
  update public.child_link_codes set used_at = now() where id = link_record.id;

  select display_name into connected_child_name from public.children where id = link_record.child_id;
  return query select link_record.child_id, connected_child_name;
end;
$$;

create or replace function public.get_my_child_profile()
returns table (child_id uuid, child_name text)
language sql
stable
security definer
set search_path = public
as $$
  select child.id, child.display_name
  from public.child_devices device
  join public.children child on child.id = device.child_id
  where device.auth_user_id = auth.uid()
    and device.revoked_at is null
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true
  limit 1;
$$;

revoke all on function public.create_child_link_code() from public;
revoke all on function public.redeem_child_link_code(text) from public;
revoke all on function public.get_my_child_profile() from public;
grant execute on function public.create_child_link_code() to authenticated;
grant execute on function public.redeem_child_link_code(text) to authenticated;
grant execute on function public.get_my_child_profile() to authenticated;
