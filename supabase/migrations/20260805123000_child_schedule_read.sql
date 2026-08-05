-- Безопасное чтение недельного расписания только для подключённого устройства ребёнка.
-- Функция не выдаёт идентификаторы семьи, родителя или права на изменение данных.

create or replace function public.get_my_weekly_lessons()
returns table (
  weekday smallint,
  lesson_order smallint,
  starts_at time,
  ends_at time,
  subject_title text,
  things text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with child_session as (
    select device.family_id
    from public.child_devices device
    where device.auth_user_id = auth.uid()
      and device.revoked_at is null
      and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true
    limit 1
  ), school_year as (
    select year.id
    from public.academic_years year
    join child_session session on session.family_id = year.family_id
    order by
      case when ((now() at time zone 'Europe/Samara')::date between year.starts_on and year.ends_on) then 0 else 1 end,
      year.starts_on desc
    limit 1
  )
  select lesson.weekday, lesson.lesson_order, lesson.starts_at, lesson.ends_at, subject.title, lesson.things
  from public.weekly_lessons lesson
  join school_year year on year.id = lesson.academic_year_id
  join public.subjects subject on subject.id = lesson.subject_id
  order by lesson.weekday, lesson.lesson_order;
$$;

revoke all on function public.get_my_weekly_lessons() from public;
grant execute on function public.get_my_weekly_lessons() to authenticated;
