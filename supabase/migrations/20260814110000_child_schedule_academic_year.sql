-- Детское расписание: безопасно отдать только границы ближайшего доступного учебного года.
-- Нужны для навигации по неделям без доступа ребёнка к родительскому редактору.

create or replace function public.get_my_schedule_academic_year()
returns table (
  id uuid,
  starts_on date,
  ends_on date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  session_family_id uuid;
  samara_today date := (now() at time zone 'Europe/Samara')::date;
begin
  if auth.uid() is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true then
    raise exception 'Connected child device is required' using errcode = '42501';
  end if;

  select device.family_id
  into session_family_id
  from public.child_devices device
  where device.auth_user_id = auth.uid()
    and device.revoked_at is null
  limit 1;

  if session_family_id is null then
    raise exception 'Connected child device is required' using errcode = '42501';
  end if;

  return query
  select academic_year.id, academic_year.starts_on, academic_year.ends_on
  from public.academic_years academic_year
  where academic_year.family_id = session_family_id
  order by
    case
      when samara_today between academic_year.starts_on and academic_year.ends_on then 0
      when academic_year.starts_on > samara_today then 1
      else 2
    end,
    case when academic_year.starts_on > samara_today then academic_year.starts_on end asc nulls last,
    academic_year.starts_on desc
  limit 1;
end;
$$;

revoke all on function public.get_my_schedule_academic_year() from public;
grant execute on function public.get_my_schedule_academic_year() to authenticated;
