-- «Школьный помощник»: семейный профиль и серверная изоляция родителя.
-- Запускается только в Supabase SQL Editor или через Supabase CLI migrations.

create table public.families (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table public.family_members (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('parent')),
  created_at timestamptz not null default now(),
  primary key (family_id, user_id),
  unique (user_id)
);

create table public.children (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null unique references public.families(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 48),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.children enable row level security;

create policy "parents read only their family"
on public.families for select to authenticated
using (exists (
  select 1 from public.family_members member
  where member.family_id = families.id
    and member.user_id = auth.uid()
    and member.role = 'parent'
));

create policy "parents read members of their family"
on public.family_members for select to authenticated
using (exists (
  select 1 from public.family_members own_membership
  where own_membership.family_id = family_members.family_id
    and own_membership.user_id = auth.uid()
    and own_membership.role = 'parent'
));

create policy "parents read their child profile"
on public.children for select to authenticated
using (exists (
  select 1 from public.family_members member
  where member.family_id = children.family_id
    and member.user_id = auth.uid()
    and member.role = 'parent'
));

grant select on public.families, public.family_members, public.children to authenticated;

create or replace function public.create_family(child_display_name text)
returns table (family_id uuid, child_id uuid, child_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_family_id uuid;
  new_child_id uuid;
  safe_child_name text := btrim(child_display_name);
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if char_length(safe_child_name) not between 1 and 48 then
    raise exception 'Child name must contain 1 to 48 characters' using errcode = '22023';
  end if;

  if exists (select 1 from public.family_members where user_id = auth.uid()) then
    raise exception 'This parent already has a family profile' using errcode = '23505';
  end if;

  insert into public.families default values returning id into new_family_id;
  insert into public.family_members (family_id, user_id, role) values (new_family_id, auth.uid(), 'parent');
  insert into public.children (family_id, display_name) values (new_family_id, safe_child_name) returning id into new_child_id;

  return query select new_family_id, new_child_id, safe_child_name;
end;
$$;

create or replace function public.get_my_family()
returns table (family_id uuid, child_id uuid, child_name text)
language sql
stable
security definer
set search_path = public
as $$
  select family.id, child.id, child.display_name
  from public.family_members member
  join public.families family on family.id = member.family_id
  join public.children child on child.family_id = family.id
  where member.user_id = auth.uid() and member.role = 'parent'
  limit 1;
$$;

revoke all on function public.create_family(text) from public;
revoke all on function public.get_my_family() from public;
grant execute on function public.create_family(text) to authenticated;
grant execute on function public.get_my_family() to authenticated;
