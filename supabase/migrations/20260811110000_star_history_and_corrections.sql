-- Полная история звёзд: понятное чтение для ребёнка и родителя,
-- неизменяемые технические корректировки и ежедневная награда без дублей.

alter table public.star_events drop constraint if exists star_events_source_type_check;
alter table public.star_events add constraint star_events_source_type_check
  check (source_type in ('homework', 'book', 'backpack', 'homework_day', 'adjustment'));

alter table public.star_events drop constraint if exists star_events_stars_check;
alter table public.star_events add constraint star_events_stars_check check (stars <> 0);

create or replace function public.award_homework_day_bonus(
  input_family_id uuid,
  input_child_id uuid,
  input_due_on date
)
returns smallint
language plpgsql security definer set search_path = public
as $$
declare
  cutoff time := '20:00';
  samara_now timestamp := now() at time zone 'Europe/Samara';
  daily_source_id uuid;
begin
  if input_due_on is distinct from samara_now::date then
    return 0;
  end if;

  select preference.notify_at
  into cutoff
  from public.notification_preferences preference
  where preference.family_id = input_family_id
    and preference.child_id = input_child_id
    and preference.kind = 'homework_check_child';

  cutoff := coalesce(cutoff, '20:00'::time);
  if samara_now::time > cutoff then
    return 0;
  end if;

  if not exists (
    select 1
    from public.homework_assignments homework
    where homework.family_id = input_family_id
      and homework.child_id = input_child_id
      and homework.due_on = input_due_on
  ) or exists (
    select 1
    from public.homework_assignments homework
    where homework.family_id = input_family_id
      and homework.child_id = input_child_id
      and homework.due_on = input_due_on
      and homework.status <> 'approved'
  ) then
    return 0;
  end if;

  daily_source_id := md5(input_child_id::text || ':' || input_due_on::text)::uuid;
  insert into public.star_events (family_id, child_id, source_type, source_id, stars, reason)
  values (
    input_family_id,
    input_child_id,
    'homework_day',
    daily_source_id,
    1,
    'Все задания дня подтверждены вовремя'
  )
  on conflict (source_type, source_id) do nothing;

  return case when found then 1 else 0 end;
end;
$$;

create or replace function public.review_homework(input_homework_id uuid, input_decision text)
returns table (id uuid, status text, stars_awarded smallint)
language plpgsql security definer set search_path = public
as $$
declare
  reviewed_id uuid;
  reviewed_status text;
  reviewed_family_id uuid;
  reviewed_child_id uuid;
  reviewed_due_on date;
  awarded smallint := 0;
begin
  if input_decision not in ('approved', 'needs_revision') then
    raise exception 'Unsupported homework decision' using errcode = '22023';
  end if;

  update public.homework_assignments homework
  set status = input_decision, updated_at = now()
  where homework.id = input_homework_id
    and homework.status = 'pending_review'
    and public.is_parent_of_family(homework.family_id)
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is false
  returning homework.id, homework.status, homework.family_id, homework.child_id, homework.due_on
  into reviewed_id, reviewed_status, reviewed_family_id, reviewed_child_id, reviewed_due_on;

  if reviewed_id is null then
    raise exception 'Homework cannot be reviewed' using errcode = '42501';
  end if;

  if input_decision = 'approved' then
    insert into public.star_events (family_id, child_id, source_type, source_id, stars, reason)
    values (reviewed_family_id, reviewed_child_id, 'homework', reviewed_id, 1, 'Подтверждённое домашнее задание')
    on conflict (source_type, source_id) do nothing;
    if found then awarded := 1; end if;

    awarded := awarded + public.award_homework_day_bonus(
      reviewed_family_id,
      reviewed_child_id,
      reviewed_due_on
    );
  end if;

  id := reviewed_id;
  status := reviewed_status;
  stars_awarded := awarded;
  return next;
end;
$$;

create or replace function public.get_my_star_history()
returns table (
  id uuid,
  source_type text,
  stars smallint,
  reason text,
  created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select event.id, event.source_type, event.stars, event.reason, event.created_at
  from public.star_events event
  join public.child_devices device
    on device.child_id = event.child_id
    and device.family_id = event.family_id
  where device.auth_user_id = auth.uid()
    and device.revoked_at is null
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true
  order by event.created_at desc, event.id desc;
$$;

create or replace function public.get_parent_star_history(input_child_id uuid)
returns table (
  id uuid,
  source_type text,
  stars smallint,
  reason text,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true
    or not exists (
      select 1
      from public.children child
      where child.id = input_child_id
        and public.is_parent_of_family(child.family_id)
    ) then
    raise exception 'Parent cannot read this star history' using errcode = '42501';
  end if;

  return query
  select event.id, event.source_type, event.stars, event.reason, event.created_at
  from public.star_events event
  where event.child_id = input_child_id
    and public.is_parent_of_family(event.family_id)
  order by event.created_at desc, event.id desc;
end;
$$;

create or replace function public.add_star_correction(
  input_child_id uuid,
  input_stars smallint,
  input_reason text
)
returns table (
  id uuid,
  source_type text,
  stars smallint,
  reason text,
  created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare
  correction_family_id uuid;
  correction_id uuid := gen_random_uuid();
  correction_reason text := btrim(coalesce(input_reason, ''));
  current_total bigint;
  correction_created_at timestamptz := now();
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true then
    raise exception 'Parent session is required' using errcode = '42501';
  end if;
  if input_stars is null or input_stars = 0 or abs(input_stars::integer) > 50 then
    raise exception 'Correction must be between -50 and 50 and cannot be zero' using errcode = '22023';
  end if;
  if char_length(correction_reason) not between 3 and 200 then
    raise exception 'Correction reason length is invalid' using errcode = '22023';
  end if;

  select child.family_id
  into correction_family_id
  from public.children child
  where child.id = input_child_id
    and public.is_parent_of_family(child.family_id)
  for update;

  if correction_family_id is null then
    raise exception 'Parent cannot correct this star history' using errcode = '42501';
  end if;

  select coalesce(sum(event.stars), 0)
  into current_total
  from public.star_events event
  where event.child_id = input_child_id
    and event.family_id = correction_family_id;

  if current_total + input_stars < 0 then
    raise exception 'Correction cannot make the total negative' using errcode = '22023';
  end if;

  insert into public.star_events (id, family_id, child_id, source_type, source_id, stars, reason, created_at)
  values (
    correction_id,
    correction_family_id,
    input_child_id,
    'adjustment',
    correction_id,
    input_stars,
    'Техническая корректировка: ' || correction_reason,
    correction_created_at
  );

  id := correction_id;
  source_type := 'adjustment';
  stars := input_stars;
  reason := 'Техническая корректировка: ' || correction_reason;
  created_at := correction_created_at;
  return next;
end;
$$;

revoke all on function public.award_homework_day_bonus(uuid, uuid, date) from public;
revoke all on function public.review_homework(uuid, text) from public;
revoke all on function public.get_my_star_history() from public;
revoke all on function public.get_parent_star_history(uuid) from public;
revoke all on function public.add_star_correction(uuid, smallint, text) from public;

grant execute on function public.review_homework(uuid, text) to authenticated;
grant execute on function public.get_my_star_history() to authenticated;
grant execute on function public.get_parent_star_history(uuid) to authenticated;
grant execute on function public.add_star_correction(uuid, smallint, text) to authenticated;
