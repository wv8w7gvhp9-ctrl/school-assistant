-- Убирает неоднозначность выходных имён target_day и checklist_id
-- в ON CONFLICT функции рюкзака.

create or replace function public.get_my_backpack()
returns table (
  checklist_id uuid,
  target_day date,
  status text,
  item_id uuid,
  item_text text,
  subject_titles text[],
  checked boolean
)
language plpgsql volatile security definer set search_path = public
as $$
declare
  session_family_id uuid;
  session_child_id uuid;
  chosen_day date;
  candidate_day date;
  saved_checklist_id uuid;
  saved_status text;
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is false then
    raise exception 'Child session is required' using errcode = '42501';
  end if;

  select device.family_id, device.child_id into session_family_id, session_child_id
  from public.child_devices device
  where device.auth_user_id = auth.uid() and device.revoked_at is null
  limit 1;

  if session_child_id is null then
    raise exception 'Connected child device is required' using errcode = '42501';
  end if;

  for candidate_day in
    select generated.day::date
    from generate_series(
      ((now() at time zone 'Europe/Samara')::date + 1)::timestamp,
      ((now() at time zone 'Europe/Samara')::date + 370)::timestamp,
      interval '1 day'
    ) generated(day)
  loop
    if exists (
      select 1 from public.get_my_schedule_for_date(candidate_day) lesson
      where lesson.status <> 'cancelled'
    ) then
      chosen_day := candidate_day;
      exit;
    end if;
  end loop;

  if chosen_day is null then return; end if;

  insert into public.backpack_checklists as saved (family_id, child_id, target_day)
  values (session_family_id, session_child_id, chosen_day)
  on conflict on constraint backpack_checklists_child_id_target_day_key
  do update set updated_at = saved.updated_at
  returning saved.id, saved.status into saved_checklist_id, saved_status;

  if saved_status <> 'approved' then
    with actual_items as (
      select lesson.subject_title, btrim(thing.value) as item_text, lower(btrim(thing.value)) as item_key
      from public.get_my_schedule_for_date(chosen_day) lesson
      cross join lateral unnest(lesson.things) thing(value)
      where lesson.status <> 'cancelled' and btrim(thing.value) <> ''
    ), grouped_items as (
      select actual.item_key, min(actual.item_text) as item_text,
        array_agg(distinct actual.subject_title order by actual.subject_title) as subject_titles
      from actual_items actual group by actual.item_key
    )
    insert into public.backpack_items (checklist_id, family_id, item_key, item_text, subject_titles)
    select saved_checklist_id, session_family_id, desired.item_key, desired.item_text, desired.subject_titles
    from grouped_items desired
    on conflict on constraint backpack_items_checklist_id_item_key_key
    do update set item_text = excluded.item_text, subject_titles = excluded.subject_titles;

    delete from public.backpack_items stored
    where stored.checklist_id = saved_checklist_id
      and not exists (
        select 1
        from public.get_my_schedule_for_date(chosen_day) lesson
        cross join lateral unnest(lesson.things) thing(value)
        where lesson.status <> 'cancelled'
          and lower(btrim(thing.value)) = stored.item_key
      );

    if exists (select 1 from public.backpack_items item where item.checklist_id = saved_checklist_id and item.checked is false) then
      update public.backpack_checklists checklist
      set status = 'packing', submitted_at = null, updated_at = now()
      where checklist.id = saved_checklist_id and checklist.status = 'pending_review';
    end if;
  end if;

  return query
  select checklist.id, checklist.target_day, checklist.status, item.id, item.item_text, item.subject_titles, item.checked
  from public.backpack_checklists checklist
  left join public.backpack_items item on item.checklist_id = checklist.id
  where checklist.id = saved_checklist_id
  order by item.item_text nulls last;
end;
$$;

revoke all on function public.get_my_backpack() from public;
grant execute on function public.get_my_backpack() to authenticated;
