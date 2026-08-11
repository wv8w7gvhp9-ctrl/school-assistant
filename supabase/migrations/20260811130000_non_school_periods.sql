-- Каникулы и неучебные дни: атомарное сохранение периода родителем,
-- спокойный статус дня для ребёнка и строгая граница учебного года.

create or replace function public.save_non_school_period(
  input_academic_year_id uuid,
  input_starts_on date,
  input_ends_on date,
  input_reason text
)
returns table (saved_days integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  session_family_id uuid;
  year_starts_on date;
  year_ends_on date;
  conflicting_days integer;
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true then
    raise exception 'Parent session is required' using errcode = '42501';
  end if;

  select year.family_id, year.starts_on, year.ends_on
  into session_family_id, year_starts_on, year_ends_on
  from public.academic_years year
  where year.id = input_academic_year_id
    and public.is_parent_of_family(year.family_id)
  limit 1;

  if session_family_id is null then
    raise exception 'Academic year not found' using errcode = '42501';
  end if;
  if input_reason not in ('weekend_override', 'holiday', 'vacation') then
    raise exception 'Unsupported non-school reason' using errcode = '22023';
  end if;
  if input_starts_on is null or input_ends_on is null or input_ends_on < input_starts_on then
    raise exception 'Invalid non-school period' using errcode = '22023';
  end if;
  if input_starts_on < year_starts_on or input_ends_on > year_ends_on then
    raise exception 'Non-school period is outside academic year' using errcode = '22023';
  end if;

  select count(*)::integer into conflicting_days
  from public.non_school_days day_off
  where day_off.family_id = session_family_id
    and day_off.day between input_starts_on and input_ends_on
    and day_off.reason <> input_reason;

  if conflicting_days > 0 then
    raise exception 'Non-school period overlaps another reason' using errcode = '23505';
  end if;

  insert into public.non_school_days (family_id, day, reason)
  select session_family_id, generated.day::date, input_reason
  from generate_series(input_starts_on::timestamp, input_ends_on::timestamp, interval '1 day') generated(day)
  on conflict (family_id, day) do nothing;

  saved_days := (input_ends_on - input_starts_on) + 1;
  return next;
end;
$$;

create or replace function public.delete_non_school_period(
  input_academic_year_id uuid,
  input_starts_on date,
  input_ends_on date,
  input_reason text
)
returns table (deleted_days integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  session_family_id uuid;
  year_starts_on date;
  year_ends_on date;
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true then
    raise exception 'Parent session is required' using errcode = '42501';
  end if;

  select year.family_id, year.starts_on, year.ends_on
  into session_family_id, year_starts_on, year_ends_on
  from public.academic_years year
  where year.id = input_academic_year_id
    and public.is_parent_of_family(year.family_id)
  limit 1;

  if session_family_id is null then
    raise exception 'Academic year not found' using errcode = '42501';
  end if;
  if input_reason not in ('weekend_override', 'holiday', 'vacation')
    or input_starts_on is null or input_ends_on is null
    or input_ends_on < input_starts_on
    or input_starts_on < year_starts_on or input_ends_on > year_ends_on then
    raise exception 'Invalid non-school period' using errcode = '22023';
  end if;

  delete from public.non_school_days day_off
  where day_off.family_id = session_family_id
    and day_off.day between input_starts_on and input_ends_on
    and day_off.reason = input_reason;
  get diagnostics deleted_days = row_count;
  return next;
end;
$$;

create or replace function public.get_my_school_day_status(input_day date)
returns table (is_school_day boolean, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  session_family_id uuid;
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is false then
    raise exception 'Child session is required' using errcode = '42501';
  end if;

  select device.family_id into session_family_id
  from public.child_devices device
  where device.auth_user_id = auth.uid()
    and device.revoked_at is null
  limit 1;

  if session_family_id is null then
    raise exception 'Connected child device is required' using errcode = '42501';
  end if;

  return query
  select day_off.id is null, day_off.reason
  from (select 1) seed
  left join public.non_school_days day_off
    on day_off.family_id = session_family_id and day_off.day = input_day;
end;
$$;

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
    where input_day between year.starts_on and year.ends_on
    order by year.starts_on desc
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
    join school_year year on true
    join school_day on school_day.is_school_day
    join public.subjects subject on subject.id = exception.subject_id
    where exception.day = input_day and exception.kind = 'extra'
  )
  select * from template_lessons
  union all
  select * from extra_lessons
  order by lesson_order;
$$;

revoke all on function public.save_non_school_period(uuid, date, date, text) from public;
revoke all on function public.delete_non_school_period(uuid, date, date, text) from public;
revoke all on function public.get_my_school_day_status(date) from public;
revoke all on function public.get_my_schedule_for_date(date) from public;
grant execute on function public.save_non_school_period(uuid, date, date, text) to authenticated;
grant execute on function public.delete_non_school_period(uuid, date, date, text) to authenticated;
grant execute on function public.get_my_school_day_status(date) to authenticated;
grant execute on function public.get_my_schedule_for_date(date) to authenticated;
