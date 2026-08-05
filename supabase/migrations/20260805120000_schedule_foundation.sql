-- Основа расписания: учебный год, предметы, повторяющиеся уроки и исключения на дату.

create table public.academic_years (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (family_id, starts_on)
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (family_id, title)
);

create table public.weekly_lessons (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  weekday smallint not null check (weekday between 1 and 5),
  lesson_order smallint not null check (lesson_order > 0),
  starts_at time not null,
  ends_at time not null,
  things text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (academic_year_id, weekday, lesson_order)
);

create table public.non_school_days (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  day date not null,
  reason text not null check (reason in ('weekend_override', 'holiday', 'vacation')),
  created_at timestamptz not null default now(),
  unique (family_id, day)
);

create table public.lesson_exceptions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  day date not null,
  weekly_lesson_id uuid references public.weekly_lessons(id) on delete cascade,
  kind text not null check (kind in ('cancelled', 'replacement', 'extra')),
  subject_id uuid references public.subjects(id) on delete restrict,
  lesson_order smallint check (lesson_order > 0),
  starts_at time,
  ends_at time,
  things text[],
  created_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (
    (kind = 'cancelled' and weekly_lesson_id is not null)
    or (kind = 'replacement' and weekly_lesson_id is not null and subject_id is not null)
    or (kind = 'extra' and weekly_lesson_id is null and subject_id is not null and lesson_order is not null and starts_at is not null and ends_at is not null)
  )
);

create unique index lesson_exceptions_one_per_template_lesson
on public.lesson_exceptions (family_id, day, weekly_lesson_id)
where weekly_lesson_id is not null;

create unique index lesson_exceptions_one_extra_per_order
on public.lesson_exceptions (family_id, day, lesson_order)
where weekly_lesson_id is null;

alter table public.academic_years enable row level security;
alter table public.subjects enable row level security;
alter table public.weekly_lessons enable row level security;
alter table public.non_school_days enable row level security;
alter table public.lesson_exceptions enable row level security;

create or replace function public.is_parent_of_family(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.family_members member
    where member.family_id = target_family_id
      and member.user_id = auth.uid()
      and member.role = 'parent'
  );
$$;

revoke all on function public.is_parent_of_family(uuid) from public;
grant execute on function public.is_parent_of_family(uuid) to authenticated;

create policy "parents manage academic years" on public.academic_years for all to authenticated
using (public.is_parent_of_family(family_id)) with check (public.is_parent_of_family(family_id));
create policy "parents manage subjects" on public.subjects for all to authenticated
using (public.is_parent_of_family(family_id)) with check (public.is_parent_of_family(family_id));
create policy "parents manage weekly lessons" on public.weekly_lessons for all to authenticated
using (public.is_parent_of_family(family_id)) with check (public.is_parent_of_family(family_id));
create policy "parents manage non-school days" on public.non_school_days for all to authenticated
using (public.is_parent_of_family(family_id)) with check (public.is_parent_of_family(family_id));
create policy "parents manage lesson exceptions" on public.lesson_exceptions for all to authenticated
using (public.is_parent_of_family(family_id)) with check (public.is_parent_of_family(family_id));

grant select, insert, update, delete on public.academic_years, public.subjects, public.weekly_lessons, public.non_school_days, public.lesson_exceptions to authenticated;
