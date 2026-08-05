-- Домашние задания: создание родителем и безопасный переход ребёнка к ожиданию проверки.

create table public.homework_assignments (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  due_on date not null,
  preferred_by time,
  task text not null check (char_length(btrim(task)) between 1 and 2000),
  status text not null default 'todo' check (status in ('todo', 'pending_review', 'approved', 'needs_revision')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.homework_assignments enable row level security;

create policy "parents manage homework" on public.homework_assignments for all to authenticated
using (public.is_parent_of_family(family_id)) with check (public.is_parent_of_family(family_id));

grant select, insert, update, delete on public.homework_assignments to authenticated;

create or replace function public.get_my_homework()
returns table (id uuid, subject_title text, due_on date, preferred_by time, task text, status text)
language sql stable security definer set search_path = public
as $$
  select homework.id, subject.title, homework.due_on, homework.preferred_by, homework.task, homework.status
  from public.homework_assignments homework
  join public.child_devices device on device.child_id = homework.child_id and device.family_id = homework.family_id
  join public.subjects subject on subject.id = homework.subject_id
  where device.auth_user_id = auth.uid() and device.revoked_at is null
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true
  order by homework.due_on, homework.preferred_by nulls last, homework.created_at;
$$;

create or replace function public.submit_my_homework_for_review(input_homework_id uuid)
returns table (id uuid, status text)
language plpgsql security definer set search_path = public
as $$
begin
  update public.homework_assignments homework
  set status = 'pending_review', updated_at = now()
  where homework.id = input_homework_id and homework.status in ('todo', 'needs_revision')
    and exists (select 1 from public.child_devices device where device.child_id = homework.child_id and device.auth_user_id = auth.uid() and device.revoked_at is null)
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true
  returning homework.id, homework.status into id, status;
  if not found then raise exception 'Homework cannot be submitted' using errcode = '42501'; end if;
  return next;
end;
$$;

revoke all on function public.get_my_homework() from public;
revoke all on function public.submit_my_homework_for_review(uuid) from public;
grant execute on function public.get_my_homework() to authenticated;
grant execute on function public.submit_my_homework_for_review(uuid) to authenticated;
