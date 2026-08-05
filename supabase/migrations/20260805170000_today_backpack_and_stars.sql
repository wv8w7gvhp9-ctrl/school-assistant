-- Экран «Сегодня», чек-лист рюкзака и подтверждение одной звезды родителем.

alter table public.star_events drop constraint star_events_source_type_check;
alter table public.star_events add constraint star_events_source_type_check check (source_type in ('homework', 'book', 'backpack'));

create table public.backpack_checklists (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  target_day date not null,
  status text not null default 'packing' check (status in ('packing', 'pending_review', 'approved')),
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (child_id, target_day)
);

create table public.backpack_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.backpack_checklists(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  item_key text not null,
  item_text text not null check (char_length(btrim(item_text)) between 1 and 160),
  subject_titles text[] not null default '{}',
  checked boolean not null default false,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (checklist_id, item_key)
);

alter table public.backpack_checklists enable row level security;
alter table public.backpack_items enable row level security;

create policy "parents read backpack checklists" on public.backpack_checklists for select to authenticated
using (public.is_parent_of_family(family_id));
create policy "parents read backpack items" on public.backpack_items for select to authenticated
using (public.is_parent_of_family(family_id));

grant select on public.backpack_checklists, public.backpack_items to authenticated;
revoke insert, update, delete on public.backpack_checklists, public.backpack_items from authenticated;

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

create or replace function public.set_my_backpack_item(input_item_id uuid, input_checked boolean)
returns table (item_id uuid, checked boolean)
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is false then
    raise exception 'Child session is required' using errcode = '42501';
  end if;

  update public.backpack_items item
  set checked = input_checked, checked_at = case when input_checked then now() else null end
  from public.backpack_checklists checklist
  where item.id = input_item_id
    and checklist.id = item.checklist_id
    and checklist.status = 'packing'
    and exists (
      select 1 from public.child_devices device
      where device.child_id = checklist.child_id
        and device.family_id = checklist.family_id
        and device.auth_user_id = auth.uid()
        and device.revoked_at is null
    )
  returning item.id, item.checked into item_id, checked;

  if item_id is null then
    raise exception 'Backpack item cannot be changed' using errcode = '42501';
  end if;
  return next;
end;
$$;

create or replace function public.submit_my_backpack(input_checklist_id uuid)
returns table (checklist_id uuid, status text)
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is false then
    raise exception 'Child session is required' using errcode = '42501';
  end if;

  update public.backpack_checklists checklist
  set status = 'pending_review', submitted_at = now(), updated_at = now()
  where checklist.id = input_checklist_id
    and checklist.status = 'packing'
    and exists (select 1 from public.backpack_items item where item.checklist_id = checklist.id)
    and not exists (select 1 from public.backpack_items item where item.checklist_id = checklist.id and item.checked is false)
    and exists (
      select 1 from public.child_devices device
      where device.child_id = checklist.child_id
        and device.family_id = checklist.family_id
        and device.auth_user_id = auth.uid()
        and device.revoked_at is null
    )
  returning checklist.id, checklist.status into checklist_id, status;

  if checklist_id is null then
    raise exception 'Backpack is not ready for review' using errcode = '22023';
  end if;
  return next;
end;
$$;

create or replace function public.get_parent_backpack_reviews()
returns table (
  checklist_id uuid,
  child_name text,
  target_day date,
  status text,
  item_id uuid,
  item_text text,
  checked boolean
)
language sql stable security definer set search_path = public
as $$
  select checklist.id, child.display_name, checklist.target_day, checklist.status,
    item.id, item.item_text, item.checked
  from public.backpack_checklists checklist
  join public.children child on child.id = checklist.child_id
  join public.backpack_items item on item.checklist_id = checklist.id
  where public.is_parent_of_family(checklist.family_id)
    and checklist.status = 'pending_review'
  order by checklist.submitted_at, item.item_text;
$$;

create or replace function public.review_backpack(input_checklist_id uuid)
returns table (checklist_id uuid, status text, stars_awarded smallint)
language plpgsql security definer set search_path = public
as $$
declare
  reviewed_id uuid;
  reviewed_family_id uuid;
  reviewed_child_id uuid;
  awarded smallint := 0;
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true then
    raise exception 'Parent session is required' using errcode = '42501';
  end if;

  update public.backpack_checklists checklist
  set status = 'approved', approved_at = now(), updated_at = now()
  where checklist.id = input_checklist_id
    and checklist.status = 'pending_review'
    and public.is_parent_of_family(checklist.family_id)
  returning checklist.id, checklist.family_id, checklist.child_id
  into reviewed_id, reviewed_family_id, reviewed_child_id;

  if reviewed_id is null then
    raise exception 'Backpack cannot be reviewed' using errcode = '42501';
  end if;

  insert into public.star_events (family_id, child_id, source_type, source_id, stars, reason)
  values (reviewed_family_id, reviewed_child_id, 'backpack', reviewed_id, 1, 'Подтверждённый собранный рюкзак')
  on conflict (source_type, source_id) do nothing;
  if found then awarded := 1; end if;

  checklist_id := reviewed_id;
  status := 'approved';
  stars_awarded := awarded;
  return next;
end;
$$;

create or replace function public.get_my_star_count()
returns bigint
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(event.stars), 0)::bigint
  from public.star_events event
  join public.child_devices device on device.child_id = event.child_id and device.family_id = event.family_id
  where device.auth_user_id = auth.uid()
    and device.revoked_at is null
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true;
$$;

revoke all on function public.get_my_backpack() from public;
revoke all on function public.set_my_backpack_item(uuid, boolean) from public;
revoke all on function public.submit_my_backpack(uuid) from public;
revoke all on function public.get_parent_backpack_reviews() from public;
revoke all on function public.review_backpack(uuid) from public;
revoke all on function public.get_my_star_count() from public;
grant execute on function public.get_my_backpack() to authenticated;
grant execute on function public.set_my_backpack_item(uuid, boolean) to authenticated;
grant execute on function public.submit_my_backpack(uuid) to authenticated;
grant execute on function public.get_parent_backpack_reviews() to authenticated;
grant execute on function public.review_backpack(uuid) to authenticated;
grant execute on function public.get_my_star_count() to authenticated;
