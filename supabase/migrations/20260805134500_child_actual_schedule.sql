-- Фактическое расписание ребёнка на конкретную дату.
-- Исключение на дату имеет приоритет над недельным шаблоном.

create or replace function public.get_my_schedule_for_date(input_day date)
returns table (
  weekday smallint,
  lesson_order smallint,
  starts_at time,
  ends_at time,
  subject_title text,
  things text[],
  status text
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
    order by case when input_day between year.starts_on and year.ends_on then 0 else 1 end, year.starts_on desc
    limit 1
  ), school_day as (
    select not exists (
      select 1 from public.non_school_days day_off
      join child_session session on session.family_id = day_off.family_id
      where day_off.day = input_day
    ) as is_school_day
  ), template_lessons as (
    select
      lesson.weekday,
      lesson.lesson_order,
      coalesce(exception.starts_at, lesson.starts_at) as starts_at,
      coalesce(exception.ends_at, lesson.ends_at) as ends_at,
      subject.title as subject_title,
      coalesce(exception.things, lesson.things) as things,
      case when exception.kind = 'cancelled' then 'cancelled' when exception.kind = 'replacement' then 'replacement' else 'regular' end as status
    from public.weekly_lessons lesson
    join school_year year on year.id = lesson.academic_year_id
    join school_day on school_day.is_school_day
    left join public.lesson_exceptions exception on exception.weekly_lesson_id = lesson.id and exception.day = input_day
    join public.subjects subject on subject.id = coalesce(exception.subject_id, lesson.subject_id)
    where lesson.weekday = extract(isodow from input_day)::smallint
  ), extra_lessons as (
    select
      extract(isodow from input_day)::smallint as weekday,
      exception.lesson_order,
      exception.starts_at,
      exception.ends_at,
      subject.title as subject_title,
      exception.things,
      'extra'::text as status
    from public.lesson_exceptions exception
    join child_session session on session.family_id = exception.family_id
    join school_day on school_day.is_school_day
    join public.subjects subject on subject.id = exception.subject_id
    where exception.day = input_day and exception.kind = 'extra'
  )
  select * from template_lessons
  union all
  select * from extra_lessons
  order by lesson_order;
$$;

revoke all on function public.get_my_schedule_for_date(date) from public;
grant execute on function public.get_my_schedule_for_date(date) to authenticated;
