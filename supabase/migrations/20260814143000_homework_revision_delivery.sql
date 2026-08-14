-- Возврат домашней работы ребёнку: безопасное чтение изменений через Realtime,
-- одно push-уведомление на каждый фактический возврат и доставка уже ожидающих
-- доработки заданий после применения миграции.

drop policy if exists "children read own homework" on public.homework_assignments;
create policy "children read own homework"
on public.homework_assignments
for select
to authenticated
using (
  coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true
  and exists (
    select 1
    from public.child_devices device
    where device.family_id = homework_assignments.family_id
      and device.child_id = homework_assignments.child_id
      and device.auth_user_id = auth.uid()
      and device.revoked_at is null
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables published
    where published.pubname = 'supabase_realtime'
      and published.schemaname = 'public'
      and published.tablename = 'homework_assignments'
  ) then
    alter publication supabase_realtime add table public.homework_assignments;
  end if;
end;
$$;

create or replace function public.enqueue_homework_child_revision_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  subject_title text;
begin
  if new.status = 'needs_revision' and old.status = 'pending_review' then
    select subject.title
    into subject_title
    from public.subjects subject
    where subject.id = new.subject_id;

    insert into public.notification_outbox (
      event_key,
      family_id,
      child_id,
      recipient_role,
      title,
      body,
      target_url,
      scheduled_for
    ) values (
      'homework-needs-revision:' || new.id::text || ':' || md5(new.updated_at::text),
      new.family_id,
      new.child_id,
      'child',
      'Домашку нужно доделать',
      left(coalesce(subject_title, 'Задание') || ': родитель попросил исправить работу.', 300),
      '/?tab=homework',
      now()
    )
    on conflict (event_key) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists homework_enqueue_child_revision_push on public.homework_assignments;
create trigger homework_enqueue_child_revision_push
after update of status on public.homework_assignments
for each row
when (old.status is distinct from new.status)
execute function public.enqueue_homework_child_revision_notification();

revoke all on function public.enqueue_homework_child_revision_notification() from public;

-- Если задание было возвращено непосредственно перед установкой исправления,
-- ребёнок получает одно пропущенное уведомление. Уникальный ключ не допускает дубль.
insert into public.notification_outbox (
  event_key,
  family_id,
  child_id,
  recipient_role,
  title,
  body,
  target_url,
  scheduled_for
)
select
  'homework-needs-revision:' || homework.id::text || ':' || md5(homework.updated_at::text),
  homework.family_id,
  homework.child_id,
  'child',
  'Домашку нужно доделать',
  left(subject.title || ': родитель попросил исправить работу.', 300),
  '/?tab=homework',
  now()
from public.homework_assignments homework
join public.subjects subject on subject.id = homework.subject_id
where homework.status = 'needs_revision'
on conflict (event_key) do nothing;
