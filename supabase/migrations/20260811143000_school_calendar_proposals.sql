-- Официальные рекомендации по каникулам не меняют семейный календарь сами.
-- Сервис создаёт предложение и уведомляет родителя; даты применяются только
-- после явного подтверждения родителем и не перезаписывают ручные записи.

create table public.school_calendar_sources (
  id uuid primary key default gen_random_uuid(),
  academic_start_year integer not null check (academic_start_year between 2020 and 2100),
  education_system text not null default 'quarters' check (education_system in ('quarters')),
  document_title text not null check (char_length(btrim(document_title)) between 1 and 240),
  document_number text not null check (char_length(btrim(document_number)) between 1 and 80),
  published_on date not null,
  source_url text not null check (source_url like 'https://%'),
  official_index_url text not null check (official_index_url like 'https://%'),
  periods jsonb not null check (jsonb_typeof(periods) = 'array'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (academic_start_year, education_system, content_hash)
);

create table public.family_calendar_proposals (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  source_id uuid not null references public.school_calendar_sources(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (family_id, source_id)
);

alter table public.non_school_days
  add column origin text not null default 'manual' check (origin in ('manual', 'official_recommendation')),
  add column calendar_proposal_id uuid references public.family_calendar_proposals(id) on delete set null;

create index family_calendar_proposals_lookup_idx
  on public.family_calendar_proposals (family_id, academic_year_id, status, created_at desc);

alter table public.school_calendar_sources enable row level security;
alter table public.family_calendar_proposals enable row level security;

revoke all on public.school_calendar_sources, public.family_calendar_proposals from anon, authenticated;
-- Запись неучебных дней остаётся доступной только через защищённые RPC:
-- так клиент не сможет выдать ручную дату за официальную рекомендацию.
revoke insert, update, delete on public.non_school_days from authenticated;

create or replace function public.validate_school_calendar_periods(
  input_academic_start_year integer,
  input_periods jsonb
)
returns void
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  period jsonb;
  starts_on date;
  ends_on date;
begin
  if input_academic_start_year not between 2020 and 2100
    or input_periods is null
    or jsonb_typeof(input_periods) <> 'array'
    or jsonb_array_length(input_periods) < 3
    or jsonb_array_length(input_periods) > 12 then
    raise exception 'Invalid school calendar periods' using errcode = '22023';
  end if;

  for period in select value from jsonb_array_elements(input_periods)
  loop
    if jsonb_typeof(period) <> 'object'
      or coalesce(period ->> 'label', '') = ''
      or coalesce(period ->> 'reason', '') not in ('vacation', 'holiday', 'weekend_override')
      or coalesce(period ->> 'starts_on', '') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(period ->> 'ends_on', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Invalid school calendar period' using errcode = '22023';
    end if;

    starts_on := (period ->> 'starts_on')::date;
    ends_on := (period ->> 'ends_on')::date;
    if ends_on < starts_on
      or starts_on < make_date(input_academic_start_year, 9, 1)
      or ends_on > make_date(input_academic_start_year + 1, 8, 31) then
      raise exception 'School calendar period is outside academic year' using errcode = '22023';
    end if;
  end loop;
end;
$$;

create or replace function public.upsert_school_calendar_source(
  input_academic_start_year integer,
  input_document_title text,
  input_document_number text,
  input_published_on date,
  input_source_url text,
  input_official_index_url text,
  input_periods jsonb,
  input_content_hash text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  source_id uuid;
begin
  perform public.validate_school_calendar_periods(input_academic_start_year, input_periods);
  if btrim(coalesce(input_document_title, '')) = ''
    or btrim(coalesce(input_document_number, '')) = ''
    or input_published_on is null
    or input_source_url not like 'https://%'
    or input_official_index_url not like 'https://%'
    or input_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid school calendar source' using errcode = '22023';
  end if;

  insert into public.school_calendar_sources (
    academic_start_year, document_title, document_number, published_on,
    source_url, official_index_url, periods, content_hash, fetched_at
  ) values (
    input_academic_start_year, btrim(input_document_title), btrim(input_document_number),
    input_published_on, input_source_url, input_official_index_url, input_periods,
    input_content_hash, now()
  )
  on conflict (academic_start_year, education_system, content_hash)
  do update set fetched_at = now()
  returning id into source_id;

  return source_id;
end;
$$;

create or replace function public.prepare_school_calendar_year(input_academic_start_year integer)
returns table (created_years integer, created_proposals integer, queued_notifications integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  family record;
  latest_source_id uuid;
  year_id uuid;
  proposal_id uuid;
  created_year boolean;
  affected integer;
begin
  if input_academic_start_year not between 2020 and 2100 then
    raise exception 'Invalid academic start year' using errcode = '22023';
  end if;

  created_years := 0;
  created_proposals := 0;
  queued_notifications := 0;

  select calendar_source.id into latest_source_id
  from public.school_calendar_sources calendar_source
  where calendar_source.academic_start_year = input_academic_start_year
    and calendar_source.education_system = 'quarters'
  order by calendar_source.published_on desc, calendar_source.created_at desc
  limit 1;

  for family in
    select household.id as family_id, child.id as child_id
    from public.families household
    join lateral (
      select family_child.id from public.children family_child
      where family_child.family_id = household.id order by family_child.created_at limit 1
    ) child on true
  loop
    year_id := null;
    insert into public.academic_years (family_id, starts_on, ends_on)
    values (
      family.family_id,
      make_date(input_academic_start_year, 9, 1),
      make_date(input_academic_start_year + 1, 5, 31)
    )
    on conflict (family_id, starts_on) do nothing
    returning id into year_id;
    created_year := year_id is not null;

    if year_id is null then
      select academic_year.id into year_id
      from public.academic_years academic_year
      where academic_year.family_id = family.family_id
        and academic_year.starts_on = make_date(input_academic_start_year, 9, 1)
      limit 1;
    else
      created_years := created_years + 1;
    end if;

    if created_year then
      insert into public.notification_outbox (
        event_key, family_id, child_id, recipient_role, title, body, target_url, scheduled_for
      ) values (
        'academic-year-created:' || family.family_id::text || ':' || input_academic_start_year::text,
        family.family_id, family.child_id, 'parent', 'Добавлен новый учебный год',
        'Учебный год ' || input_academic_start_year::text || '–' || (input_academic_start_year + 1)::text ||
          ' создан. Официальные даты каникул появятся после публикации.', '/', now()
      ) on conflict (event_key) do nothing;
      get diagnostics affected = row_count;
      queued_notifications := queued_notifications + affected;
    end if;

    if latest_source_id is not null then
      proposal_id := null;
      insert into public.family_calendar_proposals (family_id, academic_year_id, source_id)
      values (family.family_id, year_id, latest_source_id)
      on conflict (family_id, source_id) do nothing
      returning id into proposal_id;

      if proposal_id is not null then
        created_proposals := created_proposals + 1;
        insert into public.notification_outbox (
          event_key, family_id, child_id, recipient_role, title, body, target_url, scheduled_for
        ) values (
          'school-calendar-proposal:' || family.family_id::text || ':' || latest_source_id::text,
          family.family_id, family.child_id, 'parent', 'Календарь каникул готов',
          'Рекомендации на ' || input_academic_start_year::text || '–' ||
            (input_academic_start_year + 1)::text || ' учебный год готовы. Проверьте даты.', '/', now()
        ) on conflict (event_key) do nothing;
        get diagnostics affected = row_count;
        queued_notifications := queued_notifications + affected;
      end if;
    end if;
  end loop;

  return next;
end;
$$;

create or replace function public.get_my_school_calendar_proposals(input_academic_year_id uuid)
returns table (
  id uuid,
  status text,
  document_title text,
  document_number text,
  published_on date,
  source_url text,
  official_index_url text,
  periods jsonb,
  created_at timestamptz,
  reviewed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select proposal.id, proposal.status, source.document_title, source.document_number,
    source.published_on, source.source_url, source.official_index_url, source.periods,
    proposal.created_at, proposal.reviewed_at
  from public.family_calendar_proposals proposal
  join public.school_calendar_sources source on source.id = proposal.source_id
  join public.academic_years year on year.id = proposal.academic_year_id
  where proposal.academic_year_id = input_academic_year_id
    and proposal.family_id = year.family_id
    and public.is_parent_of_family(proposal.family_id)
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is false
  order by proposal.created_at desc;
$$;

create or replace function public.approve_my_school_calendar_proposal(input_proposal_id uuid)
returns table (added_days integer, preserved_days integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  proposal record;
  period jsonb;
  period_start date;
  period_end date;
  expected integer;
  affected integer;
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true then
    raise exception 'Parent session is required' using errcode = '42501';
  end if;

  select calendar_proposal.*, year.starts_on, year.ends_on, source.periods
  into proposal
  from public.family_calendar_proposals calendar_proposal
  join public.academic_years year on year.id = calendar_proposal.academic_year_id
  join public.school_calendar_sources source on source.id = calendar_proposal.source_id
  where calendar_proposal.id = input_proposal_id
    and public.is_parent_of_family(calendar_proposal.family_id)
  for update;

  if proposal.id is null then
    raise exception 'Calendar proposal not found' using errcode = '42501';
  end if;
  if proposal.status <> 'pending' then
    raise exception 'Calendar proposal was already reviewed' using errcode = '22023';
  end if;

  added_days := 0;
  preserved_days := 0;
  for period in select value from jsonb_array_elements(proposal.periods)
  loop
    period_start := greatest((period ->> 'starts_on')::date, proposal.starts_on);
    period_end := least((period ->> 'ends_on')::date, proposal.ends_on);
    if period_end >= period_start then
      expected := period_end - period_start + 1;
      insert into public.non_school_days (family_id, day, reason, origin, calendar_proposal_id)
      select proposal.family_id, generated.day::date, period ->> 'reason',
        'official_recommendation', proposal.id
      from generate_series(period_start::timestamp, period_end::timestamp, interval '1 day') generated(day)
      on conflict (family_id, day) do nothing;
      get diagnostics affected = row_count;
      added_days := added_days + affected;
      preserved_days := preserved_days + expected - affected;
    end if;
  end loop;

  update public.family_calendar_proposals
  set status = 'approved', reviewed_at = now()
  where id = proposal.id;
  update public.family_calendar_proposals
  set status = 'rejected', reviewed_at = now()
  where family_id = proposal.family_id and academic_year_id = proposal.academic_year_id
    and id <> proposal.id and status = 'pending';
  return next;
end;
$$;

create or replace function public.reject_my_school_calendar_proposal(input_proposal_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true then
    raise exception 'Parent session is required' using errcode = '42501';
  end if;
  update public.family_calendar_proposals proposal
  set status = 'rejected', reviewed_at = now()
  where proposal.id = input_proposal_id
    and proposal.status = 'pending'
    and public.is_parent_of_family(proposal.family_id);
  if not found then
    raise exception 'Calendar proposal not found' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.validate_school_calendar_periods(integer, jsonb) from public;
revoke all on function public.upsert_school_calendar_source(integer, text, text, date, text, text, jsonb, text) from public;
revoke all on function public.prepare_school_calendar_year(integer) from public;
revoke all on function public.get_my_school_calendar_proposals(uuid) from public;
revoke all on function public.approve_my_school_calendar_proposal(uuid) from public;
revoke all on function public.reject_my_school_calendar_proposal(uuid) from public;

grant execute on function public.upsert_school_calendar_source(integer, text, text, date, text, text, jsonb, text) to service_role;
grant execute on function public.prepare_school_calendar_year(integer) to service_role;
grant execute on function public.get_my_school_calendar_proposals(uuid) to authenticated;
grant execute on function public.approve_my_school_calendar_proposal(uuid) to authenticated;
grant execute on function public.reject_my_school_calendar_proposal(uuid) to authenticated;

-- Подтверждённый федеральный источник на момент создания функции.
with source_data as (
  select jsonb_build_array(
    jsonb_build_object('label', 'Осенние каникулы', 'starts_on', '2026-10-26', 'ends_on', '2026-11-03', 'reason', 'vacation'),
    jsonb_build_object('label', 'День народного единства', 'starts_on', '2026-11-04', 'ends_on', '2026-11-04', 'reason', 'holiday'),
    jsonb_build_object('label', 'Зимние каникулы', 'starts_on', '2026-12-31', 'ends_on', '2027-01-10', 'reason', 'vacation'),
    jsonb_build_object('label', 'Весенние каникулы', 'starts_on', '2027-03-27', 'ends_on', '2027-04-04', 'reason', 'vacation'),
    jsonb_build_object('label', 'Летние каникулы', 'starts_on', '2027-05-27', 'ends_on', '2027-08-31', 'reason', 'vacation')
  ) as periods
)
insert into public.school_calendar_sources (
  academic_start_year, document_title, document_number, published_on,
  source_url, official_index_url, periods, content_hash
)
select 2026,
  'Рекомендации по организации каникул в 2026/2027 учебном году',
  'ОК-1948/03', '2026-07-07',
  'https://www.consultant.ru/document/cons_doc_LAW_538951/',
  'https://www.fgbu-ac.ru/zakonodatelstvo-ob-obrazovanii/documents-of-week.php',
  source_data.periods,
  'c8daac5ec06351f7a3bc436d40dcc8cc9d3fa6ec0ebf5eebfdffb4f1585e0d9f'
from source_data
on conflict (academic_start_year, education_system, content_hash) do nothing;

select * from public.prepare_school_calendar_year(2026);
