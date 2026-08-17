-- Защищённая родительская очередь домашней работы.
-- Роль и семейная принадлежность проверяются внутри БД, поэтому клиенту
-- не требуется прямой SELECT из homework_assignments для этого сценария.

create or replace function public.get_parent_homework_reviews()
returns table (
  id uuid,
  due_on date,
  preferred_by time,
  task text,
  status text,
  updated_at timestamptz,
  subject_title text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    homework.id,
    homework.due_on,
    homework.preferred_by,
    homework.task,
    homework.status,
    homework.updated_at,
    subject.title
  from public.homework_assignments homework
  join public.subjects subject on subject.id = homework.subject_id
  where homework.status = 'pending_review'
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is false
    and exists (
      select 1
      from public.family_members member
      where member.family_id = homework.family_id
        and member.user_id = auth.uid()
        and member.role = 'parent'
    )
  order by homework.updated_at;
$$;

revoke all on function public.get_parent_homework_reviews() from public;
grant execute on function public.get_parent_homework_reviews() to authenticated;
