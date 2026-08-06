-- Идемпотентная синхронизация отметки домашнего задания после работы без сети.
-- Сервер сравнивает версию задания и не применяет устаревшее действие молча.

create table public.offline_mutation_receipts (
  mutation_id uuid primary key,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  mutation_type text not null check (mutation_type in ('submit_homework')),
  entity_id uuid not null,
  created_at timestamptz not null default now()
);

alter table public.offline_mutation_receipts enable row level security;
revoke all on public.offline_mutation_receipts from anon, authenticated;

create or replace function public.get_my_homework_v2()
returns table (
  id uuid,
  subject_title text,
  due_on date,
  preferred_by time,
  task text,
  status text,
  updated_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select
    homework.id,
    subject.title,
    homework.due_on,
    homework.preferred_by,
    homework.task,
    homework.status,
    homework.updated_at
  from public.homework_assignments homework
  join public.child_devices device
    on device.child_id = homework.child_id
   and device.family_id = homework.family_id
  join public.subjects subject on subject.id = homework.subject_id
  where device.auth_user_id = auth.uid()
    and device.revoked_at is null
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true
  order by homework.due_on, homework.preferred_by nulls last, homework.created_at;
$$;

create or replace function public.sync_my_homework_submission(
  input_homework_id uuid,
  input_mutation_id uuid,
  input_expected_updated_at timestamptz
)
returns table (id uuid, status text, outcome text)
language plpgsql security definer set search_path = public
as $$
declare
  current_status text;
  current_updated_at timestamptz;
  current_family_id uuid;
  current_child_id uuid;
  receipt_user_id uuid;
  receipt_type text;
  receipt_entity_id uuid;
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true then
    raise exception 'Anonymous child session required' using errcode = '42501';
  end if;

  select receipt.auth_user_id, receipt.mutation_type, receipt.entity_id
  into receipt_user_id, receipt_type, receipt_entity_id
  from public.offline_mutation_receipts receipt
  where receipt.mutation_id = input_mutation_id;

  if receipt_user_id is not null then
    if receipt_user_id = auth.uid()
      and receipt_type = 'submit_homework'
      and receipt_entity_id = input_homework_id then
      id := input_homework_id;
      status := 'pending_review';
      outcome := 'already_applied';
      return next;
      return;
    end if;
    raise exception 'Mutation identifier is already used' using errcode = '42501';
  end if;

  select homework.status, homework.updated_at, homework.family_id, homework.child_id
  into current_status, current_updated_at, current_family_id, current_child_id
  from public.homework_assignments homework
  where homework.id = input_homework_id
    and exists (
      select 1
      from public.child_devices device
      where device.child_id = homework.child_id
        and device.family_id = homework.family_id
        and device.auth_user_id = auth.uid()
        and device.revoked_at is null
    )
  for update;

  if current_child_id is null then
    id := input_homework_id;
    status := null;
    outcome := 'missing';
    return next;
    return;
  end if;

  if current_status in ('pending_review', 'approved') then
    insert into public.offline_mutation_receipts (
      mutation_id, auth_user_id, family_id, child_id, mutation_type, entity_id
    ) values (
      input_mutation_id, auth.uid(), current_family_id, current_child_id, 'submit_homework', input_homework_id
    );
    id := input_homework_id;
    status := current_status;
    outcome := 'already_satisfied';
    return next;
    return;
  end if;

  if current_status not in ('todo', 'needs_revision')
    or input_expected_updated_at is null
    or current_updated_at is distinct from input_expected_updated_at then
    id := input_homework_id;
    status := current_status;
    outcome := 'conflict';
    return next;
    return;
  end if;

  update public.homework_assignments homework
  set status = 'pending_review', updated_at = now()
  where homework.id = input_homework_id;

  insert into public.offline_mutation_receipts (
    mutation_id, auth_user_id, family_id, child_id, mutation_type, entity_id
  ) values (
    input_mutation_id, auth.uid(), current_family_id, current_child_id, 'submit_homework', input_homework_id
  );

  id := input_homework_id;
  status := 'pending_review';
  outcome := 'applied';
  return next;
end;
$$;

revoke all on function public.get_my_homework_v2() from public;
revoke all on function public.sync_my_homework_submission(uuid, uuid, timestamptz) from public;
grant execute on function public.get_my_homework_v2() to authenticated;
grant execute on function public.sync_my_homework_submission(uuid, uuid, timestamptz) to authenticated;
