-- Идемпотентная синхронизация отметок и отправки рюкзака после работы без сети.
-- Каждая операция проверяет детское устройство, семью и версию серверной записи.

alter table public.backpack_items
  add column updated_at timestamptz not null default now();

alter table public.offline_mutation_receipts
  drop constraint offline_mutation_receipts_mutation_type_check;
alter table public.offline_mutation_receipts
  add constraint offline_mutation_receipts_mutation_type_check
  check (mutation_type in ('submit_homework', 'set_backpack_item', 'submit_backpack'));

alter table public.offline_mutation_receipts
  add column mutation_payload jsonb;

create or replace function public.get_my_backpack_v2()
returns table (
  checklist_id uuid,
  target_day date,
  status text,
  checklist_updated_at timestamptz,
  item_id uuid,
  item_text text,
  subject_titles text[],
  checked boolean,
  item_updated_at timestamptz
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
    insert into public.backpack_items as saved_item (
      checklist_id, family_id, item_key, item_text, subject_titles
    )
    select saved_checklist_id, session_family_id, desired.item_key, desired.item_text, desired.subject_titles
    from grouped_items desired
    on conflict on constraint backpack_items_checklist_id_item_key_key
    do update set
      item_text = excluded.item_text,
      subject_titles = excluded.subject_titles,
      updated_at = case
        when saved_item.item_text is distinct from excluded.item_text
          or saved_item.subject_titles is distinct from excluded.subject_titles
        then now()
        else saved_item.updated_at
      end;

    delete from public.backpack_items stored
    where stored.checklist_id = saved_checklist_id
      and not exists (
        select 1
        from public.get_my_schedule_for_date(chosen_day) lesson
        cross join lateral unnest(lesson.things) thing(value)
        where lesson.status <> 'cancelled'
          and lower(btrim(thing.value)) = stored.item_key
      );

    if exists (
      select 1 from public.backpack_items item
      where item.checklist_id = saved_checklist_id and item.checked is false
    ) then
      update public.backpack_checklists checklist
      set status = 'packing', submitted_at = null, updated_at = now()
      where checklist.id = saved_checklist_id and checklist.status = 'pending_review';
    end if;
  end if;

  return query
  select checklist.id, checklist.target_day, checklist.status, checklist.updated_at,
    item.id, item.item_text, item.subject_titles, item.checked, item.updated_at
  from public.backpack_checklists checklist
  left join public.backpack_items item on item.checklist_id = checklist.id
  where checklist.id = saved_checklist_id
  order by item.item_text nulls last;
end;
$$;

create or replace function public.sync_my_backpack_item(
  input_item_id uuid,
  input_mutation_id uuid,
  input_checked boolean,
  input_expected_updated_at timestamptz
)
returns table (item_id uuid, checked boolean, updated_at timestamptz, outcome text)
language plpgsql security definer set search_path = public
as $$
declare
  current_checked boolean;
  current_updated_at timestamptz;
  current_status text;
  current_checklist_id uuid;
  current_family_id uuid;
  current_child_id uuid;
  receipt_user_id uuid;
  receipt_type text;
  receipt_entity_id uuid;
  receipt_payload jsonb;
  requested_payload jsonb;
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true then
    raise exception 'Anonymous child session required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(input_mutation_id::text, 0));

  requested_payload := jsonb_build_object(
    'checked', input_checked,
    'expected_updated_at', to_jsonb(input_expected_updated_at)
  );

  select receipt.auth_user_id, receipt.mutation_type, receipt.entity_id, receipt.mutation_payload
  into receipt_user_id, receipt_type, receipt_entity_id, receipt_payload
  from public.offline_mutation_receipts receipt
  where receipt.mutation_id = input_mutation_id;

  if receipt_user_id is not null then
    if receipt_user_id = auth.uid()
      and receipt_type = 'set_backpack_item'
      and receipt_entity_id = input_item_id
      and receipt_payload = requested_payload then
      item_id := input_item_id;
      checked := input_checked;
      updated_at := null;
      outcome := 'already_applied';
      return next;
      return;
    end if;
    item_id := input_item_id;
    checked := null;
    updated_at := null;
    outcome := 'conflict';
    return next;
    return;
  end if;

  select checklist.id, checklist.family_id, checklist.child_id
  into current_checklist_id, current_family_id, current_child_id
  from public.backpack_items item
  join public.backpack_checklists checklist on checklist.id = item.checklist_id
  where item.id = input_item_id
    and exists (
      select 1 from public.child_devices device
      where device.child_id = checklist.child_id
        and device.family_id = checklist.family_id
        and device.auth_user_id = auth.uid()
        and device.revoked_at is null
    )
  limit 1;

  if current_checklist_id is null then
    item_id := input_item_id;
    checked := null;
    updated_at := null;
    outcome := 'missing';
    return next;
    return;
  end if;

  select checklist.status
  into current_status
  from public.backpack_checklists checklist
  where checklist.id = current_checklist_id
  for update;

  select item.checked, item.updated_at
  into current_checked, current_updated_at
  from public.backpack_items item
  where item.id = input_item_id and item.checklist_id = current_checklist_id
  for update;

  if current_updated_at is null then
    item_id := input_item_id;
    checked := null;
    updated_at := null;
    outcome := 'missing';
    return next;
    return;
  end if;

  if current_status <> 'packing' then
    item_id := input_item_id;
    checked := current_checked;
    updated_at := current_updated_at;
    outcome := 'conflict';
    return next;
    return;
  end if;

  if input_expected_updated_at is null
    or current_updated_at is distinct from input_expected_updated_at then
    if current_checked = input_checked then
      insert into public.offline_mutation_receipts (
        mutation_id, auth_user_id, family_id, child_id, mutation_type, entity_id, mutation_payload
      ) values (
        input_mutation_id, auth.uid(), current_family_id, current_child_id,
        'set_backpack_item', input_item_id, requested_payload
      );
      item_id := input_item_id;
      checked := current_checked;
      updated_at := current_updated_at;
      outcome := 'already_satisfied';
      return next;
      return;
    end if;

    item_id := input_item_id;
    checked := current_checked;
    updated_at := current_updated_at;
    outcome := 'conflict';
    return next;
    return;
  end if;

  update public.backpack_items item
  set checked = input_checked,
    checked_at = case when input_checked then now() else null end,
    updated_at = now()
  where item.id = input_item_id
  returning item.checked, item.updated_at into checked, updated_at;

  insert into public.offline_mutation_receipts (
    mutation_id, auth_user_id, family_id, child_id, mutation_type, entity_id, mutation_payload
  ) values (
    input_mutation_id, auth.uid(), current_family_id, current_child_id,
    'set_backpack_item', input_item_id, requested_payload
  );

  item_id := input_item_id;
  outcome := 'applied';
  return next;
end;
$$;

create or replace function public.sync_my_backpack_submission(
  input_checklist_id uuid,
  input_mutation_id uuid,
  input_expected_updated_at timestamptz
)
returns table (checklist_id uuid, status text, updated_at timestamptz, outcome text)
language plpgsql security definer set search_path = public
as $$
declare
  current_status text;
  current_updated_at timestamptz;
  current_family_id uuid;
  current_child_id uuid;
  receipt_user_id uuid;
  receipt_type text;
  receipt_entity_id uuid;
  receipt_payload jsonb;
  requested_payload jsonb;
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true then
    raise exception 'Anonymous child session required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(input_mutation_id::text, 0));

  requested_payload := jsonb_build_object(
    'expected_updated_at', to_jsonb(input_expected_updated_at)
  );

  select receipt.auth_user_id, receipt.mutation_type, receipt.entity_id, receipt.mutation_payload
  into receipt_user_id, receipt_type, receipt_entity_id, receipt_payload
  from public.offline_mutation_receipts receipt
  where receipt.mutation_id = input_mutation_id;

  if receipt_user_id is not null then
    if receipt_user_id = auth.uid()
      and receipt_type = 'submit_backpack'
      and receipt_entity_id = input_checklist_id
      and receipt_payload = requested_payload then
      checklist_id := input_checklist_id;
      status := 'pending_review';
      updated_at := null;
      outcome := 'already_applied';
      return next;
      return;
    end if;
    checklist_id := input_checklist_id;
    status := null;
    updated_at := null;
    outcome := 'conflict';
    return next;
    return;
  end if;

  select checklist.status, checklist.updated_at, checklist.family_id, checklist.child_id
  into current_status, current_updated_at, current_family_id, current_child_id
  from public.backpack_checklists checklist
  where checklist.id = input_checklist_id
    and exists (
      select 1 from public.child_devices device
      where device.child_id = checklist.child_id
        and device.family_id = checklist.family_id
        and device.auth_user_id = auth.uid()
        and device.revoked_at is null
    )
  for update;

  if current_child_id is null then
    checklist_id := input_checklist_id;
    status := null;
    updated_at := null;
    outcome := 'missing';
    return next;
    return;
  end if;

  if current_status in ('pending_review', 'approved') then
    insert into public.offline_mutation_receipts (
      mutation_id, auth_user_id, family_id, child_id, mutation_type, entity_id, mutation_payload
    ) values (
      input_mutation_id, auth.uid(), current_family_id, current_child_id,
      'submit_backpack', input_checklist_id, requested_payload
    );
    checklist_id := input_checklist_id;
    status := current_status;
    updated_at := current_updated_at;
    outcome := 'already_satisfied';
    return next;
    return;
  end if;

  if current_status <> 'packing'
    or input_expected_updated_at is null
    or current_updated_at is distinct from input_expected_updated_at then
    checklist_id := input_checklist_id;
    status := current_status;
    updated_at := current_updated_at;
    outcome := 'conflict';
    return next;
    return;
  end if;

  if not exists (
      select 1 from public.backpack_items item where item.checklist_id = input_checklist_id
    ) or exists (
      select 1 from public.backpack_items item
      where item.checklist_id = input_checklist_id and item.checked is false
    ) then
    checklist_id := input_checklist_id;
    status := current_status;
    updated_at := current_updated_at;
    outcome := 'not_ready';
    return next;
    return;
  end if;

  update public.backpack_checklists checklist
  set status = 'pending_review', submitted_at = now(), updated_at = now()
  where checklist.id = input_checklist_id
  returning checklist.status, checklist.updated_at into status, updated_at;

  insert into public.offline_mutation_receipts (
    mutation_id, auth_user_id, family_id, child_id, mutation_type, entity_id, mutation_payload
  ) values (
    input_mutation_id, auth.uid(), current_family_id, current_child_id,
    'submit_backpack', input_checklist_id, requested_payload
  );

  checklist_id := input_checklist_id;
  outcome := 'applied';
  return next;
end;
$$;

revoke all on function public.get_my_backpack_v2() from public;
revoke all on function public.sync_my_backpack_item(uuid, uuid, boolean, timestamptz) from public;
revoke all on function public.sync_my_backpack_submission(uuid, uuid, timestamptz) from public;
grant execute on function public.get_my_backpack_v2() to authenticated;
grant execute on function public.sync_my_backpack_item(uuid, uuid, boolean, timestamptz) to authenticated;
grant execute on function public.sync_my_backpack_submission(uuid, uuid, timestamptz) to authenticated;
