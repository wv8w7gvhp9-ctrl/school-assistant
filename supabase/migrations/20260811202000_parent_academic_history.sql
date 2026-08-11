-- Единая история ребёнка за выбранный учебный год.
-- Доступна только постоянной родительской сессии своей семьи.

create or replace function public.get_parent_academic_years()
returns table (
  id uuid,
  starts_on date,
  ends_on date,
  is_current boolean,
  is_completed boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true then
    raise exception 'Parent session is required' using errcode = '42501';
  end if;

  return query
  select
    academic_year.id,
    academic_year.starts_on,
    academic_year.ends_on,
    (now() at time zone 'Europe/Samara')::date
      between academic_year.starts_on and academic_year.ends_on,
    academic_year.ends_on < (now() at time zone 'Europe/Samara')::date
  from public.academic_years academic_year
  join public.family_members member
    on member.family_id = academic_year.family_id
  where member.user_id = auth.uid()
    and member.role = 'parent'
  order by academic_year.starts_on desc;
end;
$$;

create or replace function public.get_parent_academic_history(input_academic_year_id uuid)
returns table (
  event_key text,
  category text,
  occurred_on date,
  occurred_at timestamptz,
  title text,
  detail text,
  status text,
  stars smallint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  selected_family_id uuid;
  selected_starts_on date;
  selected_ends_on date;
begin
  if auth.uid() is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true then
    raise exception 'Parent session is required' using errcode = '42501';
  end if;

  select academic_year.family_id, academic_year.starts_on, academic_year.ends_on
  into selected_family_id, selected_starts_on, selected_ends_on
  from public.academic_years academic_year
  join public.family_members member
    on member.family_id = academic_year.family_id
  where academic_year.id = input_academic_year_id
    and member.user_id = auth.uid()
    and member.role = 'parent'
  limit 1;

  if selected_family_id is null then
    raise exception 'Academic year is not available' using errcode = '42501';
  end if;

  return query
  with history as (
    select
      'homework:' || homework.id::text as event_key,
      'homework'::text as category,
      homework.due_on as occurred_on,
      homework.updated_at as occurred_at,
      subject.title as title,
      homework.task as detail,
      homework.status as status,
      null::smallint as stars
    from public.homework_assignments homework
    join public.subjects subject on subject.id = homework.subject_id
    where homework.family_id = selected_family_id
      and homework.due_on between selected_starts_on and selected_ends_on

    union all

    select
      'book:' || book.id::text,
      'book'::text,
      coalesce(book.finished_on, book.started_on, (book.created_at at time zone 'Europe/Samara')::date),
      book.updated_at,
      book.title,
      book.author,
      book.status || ':' || book.review_status,
      null::smallint
    from public.books book
    where book.family_id = selected_family_id
      and coalesce(book.finished_on, book.started_on, (book.created_at at time zone 'Europe/Samara')::date)
        between selected_starts_on and selected_ends_on

    union all

    select
      'backpack:' || checklist.id::text,
      'backpack'::text,
      checklist.target_day,
      coalesce(checklist.approved_at, checklist.submitted_at, checklist.updated_at),
      'Рюкзак'::text,
      coalesce((
        select string_agg(item.item_text, ' · ' order by item.item_text)
        from public.backpack_items item
        where item.checklist_id = checklist.id
      ), 'Без вещей'),
      checklist.status,
      null::smallint
    from public.backpack_checklists checklist
    where checklist.family_id = selected_family_id
      and checklist.target_day between selected_starts_on and selected_ends_on

    union all

    select
      'star:' || star_event.id::text,
      'stars'::text,
      (star_event.created_at at time zone 'Europe/Samara')::date,
      star_event.created_at,
      star_event.reason,
      ''::text,
      star_event.source_type,
      star_event.stars
    from public.star_events star_event
    where star_event.family_id = selected_family_id
      and (star_event.created_at at time zone 'Europe/Samara')::date
        between selected_starts_on and selected_ends_on
  )
  select
    history.event_key,
    history.category,
    history.occurred_on,
    history.occurred_at,
    history.title,
    history.detail,
    history.status,
    history.stars
  from history
  order by history.occurred_on desc, history.occurred_at desc, history.event_key;
end;
$$;

revoke all on function public.get_parent_academic_years() from public;
revoke all on function public.get_parent_academic_history(uuid) from public;
grant execute on function public.get_parent_academic_years() to authenticated;
grant execute on function public.get_parent_academic_history(uuid) to authenticated;
