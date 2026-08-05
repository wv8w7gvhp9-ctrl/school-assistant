-- Кружки: регулярное расписание, напоминания и отмены/переносы на конкретную дату.

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  weekday smallint not null check (weekday between 1 and 7),
  starts_at time not null,
  ends_at time,
  things text[] not null default '{}',
  reminder_enabled boolean not null default true,
  reminder_minutes smallint not null default 30 check (reminder_minutes between 0 and 1440),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create table public.club_exceptions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  original_day date not null,
  kind text not null check (kind in ('cancelled', 'rescheduled')),
  replacement_day date,
  starts_at time,
  ends_at time,
  things text[],
  created_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check ((kind = 'cancelled' and replacement_day is null) or (kind = 'rescheduled' and replacement_day is not null)),
  unique (club_id, original_day)
);

alter table public.clubs enable row level security;
alter table public.club_exceptions enable row level security;

create or replace function public.validate_club_family()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.children child where child.id = new.child_id and child.family_id = new.family_id) then
    raise exception 'Child does not belong to club family' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.validate_club_exception()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  club_weekday smallint;
  club_family_id uuid;
begin
  select club.weekday, club.family_id into club_weekday, club_family_id from public.clubs club where club.id = new.club_id;
  if club_family_id is distinct from new.family_id then
    raise exception 'Club does not belong to exception family' using errcode = '23514';
  end if;
  if extract(isodow from new.original_day)::smallint <> club_weekday then
    raise exception 'Exception date does not match regular club weekday' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger clubs_validate_family before insert or update of family_id, child_id on public.clubs
for each row execute function public.validate_club_family();
create trigger club_exceptions_validate before insert or update on public.club_exceptions
for each row execute function public.validate_club_exception();

create policy "parents manage clubs" on public.clubs for all to authenticated
using (public.is_parent_of_family(family_id)) with check (public.is_parent_of_family(family_id));
create policy "parents manage club exceptions" on public.club_exceptions for all to authenticated
using (public.is_parent_of_family(family_id)) with check (public.is_parent_of_family(family_id));

grant select, insert, update, delete on public.clubs, public.club_exceptions to authenticated;

create or replace function public.get_my_clubs()
returns table (
  id uuid,
  title text,
  weekday smallint,
  starts_at time,
  ends_at time,
  things text[],
  reminder_enabled boolean,
  reminder_minutes smallint,
  active boolean
)
language sql stable security definer set search_path = public
as $$
  select club.id, club.title, club.weekday, club.starts_at, club.ends_at, club.things,
    club.reminder_enabled, club.reminder_minutes, club.active
  from public.clubs club
  join public.child_devices device on device.child_id = club.child_id and device.family_id = club.family_id
  where device.auth_user_id = auth.uid()
    and device.revoked_at is null
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true
  order by club.weekday, club.starts_at, club.title;
$$;

create or replace function public.get_my_club_occurrences(input_from date, input_to date)
returns table (
  club_id uuid,
  title text,
  occurs_on date,
  starts_at time,
  ends_at time,
  things text[],
  reminder_enabled boolean,
  reminder_minutes smallint,
  status text,
  replacement_day date
)
language sql stable security definer set search_path = public
as $$
  with connected as (
    select device.child_id, device.family_id
    from public.child_devices device
    where device.auth_user_id = auth.uid()
      and device.revoked_at is null
      and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true
    limit 1
  ), calendar as (
    select generated.day::date as day
    from generate_series(input_from::timestamp, input_to::timestamp, interval '1 day') generated(day)
  ), regular_occurrences as (
    select
      club.id as club_id,
      club.title,
      calendar.day as occurs_on,
      club.starts_at,
      club.ends_at,
      club.things,
      club.reminder_enabled,
      club.reminder_minutes,
      case exception.kind when 'cancelled' then 'cancelled' when 'rescheduled' then 'rescheduled_from' else 'regular' end as status,
      exception.replacement_day
    from connected
    join public.clubs club on club.child_id = connected.child_id and club.family_id = connected.family_id and club.active
    join calendar on extract(isodow from calendar.day)::smallint = club.weekday
    left join public.club_exceptions exception on exception.club_id = club.id and exception.original_day = calendar.day
  ), moved_occurrences as (
    select
      club.id as club_id,
      club.title,
      exception.replacement_day as occurs_on,
      coalesce(exception.starts_at, club.starts_at) as starts_at,
      coalesce(exception.ends_at, club.ends_at) as ends_at,
      coalesce(exception.things, club.things) as things,
      club.reminder_enabled,
      club.reminder_minutes,
      'rescheduled'::text as status,
      exception.replacement_day
    from connected
    join public.clubs club on club.child_id = connected.child_id and club.family_id = connected.family_id and club.active
    join public.club_exceptions exception on exception.club_id = club.id and exception.kind = 'rescheduled'
    where exception.replacement_day between input_from and input_to
  )
  select * from regular_occurrences
  union all
  select * from moved_occurrences
  order by occurs_on, starts_at, title;
$$;

revoke all on function public.get_my_clubs() from public;
revoke all on function public.get_my_club_occurrences(date, date) from public;
revoke all on function public.validate_club_family() from public;
revoke all on function public.validate_club_exception() from public;
grant execute on function public.get_my_clubs() to authenticated;
grant execute on function public.get_my_club_occurrences(date, date) to authenticated;
