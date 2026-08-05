-- Устраняет конфликт имени выходного поля функции expires_at и столбца таблицы.

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
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
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

  update public.child_link_codes as link_code
  set expires_at = now()
  where link_code.family_id = own_family_id
    and link_code.used_at is null
    and link_code.expires_at > now();

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
