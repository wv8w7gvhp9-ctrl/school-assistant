-- Полный безопасный поток проверки домашки и защита от повторного начисления звезды.

create table public.homework_status_events (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid not null references public.homework_assignments(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  from_status text check (from_status is null or from_status in ('todo', 'pending_review', 'approved', 'needs_revision')),
  to_status text not null check (to_status in ('todo', 'pending_review', 'approved', 'needs_revision')),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_role text not null check (actor_role in ('parent', 'child')),
  created_at timestamptz not null default now()
);

create table public.star_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  source_type text not null check (source_type in ('homework')),
  source_id uuid not null,
  stars smallint not null check (stars > 0),
  reason text not null,
  created_at timestamptz not null default now(),
  unique (source_type, source_id)
);

alter table public.homework_status_events enable row level security;
alter table public.star_events enable row level security;

create policy "parents read homework status events" on public.homework_status_events for select to authenticated
using (public.is_parent_of_family(family_id));
create policy "parents read star events" on public.star_events for select to authenticated
using (public.is_parent_of_family(family_id));

grant select on public.homework_status_events, public.star_events to authenticated;
revoke insert, update, delete on public.homework_status_events, public.star_events from authenticated;

create or replace function public.log_homework_status_event()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into public.homework_status_events (
      homework_id, family_id, child_id, from_status, to_status, actor_user_id, actor_role
    ) values (
      new.id,
      new.family_id,
      new.child_id,
      case when tg_op = 'INSERT' then null else old.status end,
      new.status,
      auth.uid(),
      case when coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then 'child' else 'parent' end
    );
  end if;
  return new;
end;
$$;

create trigger homework_status_audit
after insert or update of status on public.homework_assignments
for each row execute function public.log_homework_status_event();

-- Статус меняется только через защищённые серверные функции. Родитель может
-- отдельно редактировать содержание и дату, ребёнок не получает прямой UPDATE.
revoke update on public.homework_assignments from authenticated;
grant update (subject_id, due_on, preferred_by, task, updated_at) on public.homework_assignments to authenticated;

create or replace function public.submit_my_homework_for_review(input_homework_id uuid)
returns table (id uuid, status text)
language plpgsql security definer set search_path = public
as $$
declare
  submitted_id uuid;
  submitted_status text;
begin
  update public.homework_assignments homework
  set status = 'pending_review', updated_at = now()
  where homework.id = input_homework_id
    and homework.status in ('todo', 'needs_revision')
    and exists (
      select 1 from public.child_devices device
      where device.child_id = homework.child_id
        and device.family_id = homework.family_id
        and device.auth_user_id = auth.uid()
        and device.revoked_at is null
    )
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true
  returning homework.id, homework.status into submitted_id, submitted_status;

  if submitted_id is null then
    raise exception 'Homework cannot be submitted' using errcode = '42501';
  end if;

  id := submitted_id;
  status := submitted_status;
  return next;
end;
$$;

create or replace function public.review_homework(input_homework_id uuid, input_decision text)
returns table (id uuid, status text, stars_awarded smallint)
language plpgsql security definer set search_path = public
as $$
declare
  reviewed_id uuid;
  reviewed_status text;
  reviewed_family_id uuid;
  reviewed_child_id uuid;
  awarded smallint := 0;
begin
  if input_decision not in ('approved', 'needs_revision') then
    raise exception 'Unsupported homework decision' using errcode = '22023';
  end if;

  update public.homework_assignments homework
  set status = input_decision, updated_at = now()
  where homework.id = input_homework_id
    and homework.status = 'pending_review'
    and public.is_parent_of_family(homework.family_id)
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is false
  returning homework.id, homework.status, homework.family_id, homework.child_id
  into reviewed_id, reviewed_status, reviewed_family_id, reviewed_child_id;

  if reviewed_id is null then
    raise exception 'Homework cannot be reviewed' using errcode = '42501';
  end if;

  if input_decision = 'approved' then
    insert into public.star_events (family_id, child_id, source_type, source_id, stars, reason)
    values (reviewed_family_id, reviewed_child_id, 'homework', reviewed_id, 1, 'Подтверждённое домашнее задание')
    on conflict (source_type, source_id) do nothing;
    if found then awarded := 1; end if;
  end if;

  id := reviewed_id;
  status := reviewed_status;
  stars_awarded := awarded;
  return next;
end;
$$;

revoke all on function public.log_homework_status_event() from public;
revoke all on function public.submit_my_homework_for_review(uuid) from public;
revoke all on function public.review_homework(uuid, text) from public;
grant execute on function public.submit_my_homework_for_review(uuid) to authenticated;
grant execute on function public.review_homework(uuid, text) to authenticated;
