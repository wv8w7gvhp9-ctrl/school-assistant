-- Web Push: подписки устройств, родительские настройки, очередь с защитой от дублей
-- и атомарные событийные уведомления. Время рассчитывается в Europe/Samara.

create table public.notification_preferences (
  family_id uuid not null references public.families(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  kind text not null check (kind in (
    'wake', 'breakfast', 'today_plan', 'homework_start',
    'homework_check_child', 'bedtime', 'unfinished_homework_parent'
  )),
  recipient_role text not null check (recipient_role in ('parent', 'child')),
  enabled boolean not null default true,
  notify_at time not null,
  updated_at timestamptz not null default now(),
  primary key (child_id, kind),
  check (
    (kind = 'unfinished_homework_parent' and recipient_role = 'parent')
    or (kind <> 'unfinished_homework_parent' and recipient_role = 'child')
  )
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_role text not null check (recipient_role in ('parent', 'child')),
  endpoint text not null check (char_length(endpoint) between 20 and 4096 and endpoint like 'https://%'),
  endpoint_hash text not null unique,
  p256dh text not null check (char_length(p256dh) between 20 and 512),
  auth_secret text not null check (char_length(auth_secret) between 8 and 256),
  device_label text not null default 'Устройство' check (char_length(device_label) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_subscriptions_delivery_idx
  on public.push_subscriptions (family_id, child_id, recipient_role)
  where active;

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique check (char_length(event_key) between 1 and 240),
  family_id uuid not null references public.families(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  recipient_role text not null check (recipient_role in ('parent', 'child')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 300),
  target_url text not null default '/' check (left(target_url, 1) = '/'),
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'retry', 'sent', 'no_targets', 'failed', 'cancelled')),
  attempts smallint not null default 0 check (attempts between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notification_outbox_due_idx
  on public.notification_outbox (scheduled_for, next_attempt_at)
  where status in ('pending', 'retry');

alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_outbox enable row level security;

revoke all on public.notification_preferences, public.push_subscriptions, public.notification_outbox from anon, authenticated;

create or replace function public.add_default_notification_preferences(
  input_family_id uuid,
  input_child_id uuid
)
returns void
language sql security definer set search_path = public
as $$
  insert into public.notification_preferences (family_id, child_id, kind, recipient_role, notify_at)
  values
    (input_family_id, input_child_id, 'wake', 'child', '06:30'),
    (input_family_id, input_child_id, 'breakfast', 'child', '07:00'),
    (input_family_id, input_child_id, 'today_plan', 'child', '07:30'),
    (input_family_id, input_child_id, 'homework_start', 'child', '15:00'),
    (input_family_id, input_child_id, 'homework_check_child', 'child', '20:00'),
    (input_family_id, input_child_id, 'bedtime', 'child', '21:30'),
    (input_family_id, input_child_id, 'unfinished_homework_parent', 'parent', '20:00')
  on conflict (child_id, kind) do nothing;
$$;

insert into public.notification_preferences (family_id, child_id, kind, recipient_role, notify_at)
select child.family_id, child.id, defaults.kind, defaults.recipient_role, defaults.notify_at
from public.children child
cross join (values
  ('wake', 'child', '06:30'::time),
  ('breakfast', 'child', '07:00'::time),
  ('today_plan', 'child', '07:30'::time),
  ('homework_start', 'child', '15:00'::time),
  ('homework_check_child', 'child', '20:00'::time),
  ('bedtime', 'child', '21:30'::time),
  ('unfinished_homework_parent', 'parent', '20:00'::time)
) defaults(kind, recipient_role, notify_at)
on conflict (child_id, kind) do nothing;

create or replace function public.seed_child_notification_preferences()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.add_default_notification_preferences(new.family_id, new.id);
  return new;
end;
$$;

create trigger children_seed_notification_preferences
after insert on public.children
for each row execute function public.seed_child_notification_preferences();

create or replace function public.get_my_notification_preferences()
returns table (
  kind text,
  enabled boolean,
  notify_at time,
  recipient_role text
)
language plpgsql security definer set search_path = public
as $$
declare
  own_family_id uuid;
  own_child_id uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) then
    raise exception 'Parent session required' using errcode = '42501';
  end if;

  select member.family_id, child.id
  into own_family_id, own_child_id
  from public.family_members member
  join public.children child on child.family_id = member.family_id
  where member.user_id = auth.uid() and member.role = 'parent'
  limit 1;

  if own_child_id is null then
    raise exception 'Family profile not found' using errcode = 'P0002';
  end if;

  perform public.add_default_notification_preferences(own_family_id, own_child_id);

  return query
  select preference.kind, preference.enabled, preference.notify_at, preference.recipient_role
  from public.notification_preferences preference
  where preference.child_id = own_child_id
  order by case preference.kind
    when 'wake' then 1 when 'breakfast' then 2 when 'today_plan' then 3
    when 'homework_start' then 4 when 'homework_check_child' then 5
    when 'bedtime' then 6 else 7 end;
end;
$$;

create or replace function public.update_my_notification_preferences(input_preferences jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  own_family_id uuid;
  own_child_id uuid;
  preference jsonb;
  preference_kind text;
  preference_time time;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) then
    raise exception 'Parent session required' using errcode = '42501';
  end if;
  if jsonb_typeof(input_preferences) <> 'array'
    or jsonb_array_length(input_preferences) < 1
    or jsonb_array_length(input_preferences) > 7 then
    raise exception 'Preferences must be a non-empty array' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(input_preferences))
    <> (select count(distinct item ->> 'kind') from jsonb_array_elements(input_preferences) item) then
    raise exception 'Duplicate preference kind' using errcode = '22023';
  end if;

  select member.family_id, child.id
  into own_family_id, own_child_id
  from public.family_members member
  join public.children child on child.family_id = member.family_id
  where member.user_id = auth.uid() and member.role = 'parent'
  limit 1;

  if own_child_id is null then
    raise exception 'Family profile not found' using errcode = 'P0002';
  end if;
  perform public.add_default_notification_preferences(own_family_id, own_child_id);

  for preference in select value from jsonb_array_elements(input_preferences)
  loop
    preference_kind := preference ->> 'kind';
    if preference_kind not in (
      'wake', 'breakfast', 'today_plan', 'homework_start',
      'homework_check_child', 'bedtime', 'unfinished_homework_parent'
    ) or jsonb_typeof(preference -> 'enabled') <> 'boolean'
      or coalesce(preference ->> 'notify_at', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Invalid notification preference' using errcode = '22023';
    end if;
    preference_time := (preference ->> 'notify_at')::time;
    update public.notification_preferences saved
    set enabled = (preference ->> 'enabled')::boolean,
      notify_at = preference_time,
      updated_at = now()
    where saved.child_id = own_child_id and saved.kind = preference_kind;
  end loop;
end;
$$;

create or replace function public.upsert_my_push_subscription(
  input_endpoint text,
  input_p256dh text,
  input_auth text,
  input_device_label text
)
returns table (id uuid, recipient_role text, active boolean, updated_at timestamptz)
language plpgsql security definer set search_path = public, extensions
as $$
declare
  own_family_id uuid;
  own_child_id uuid;
  own_role text;
  safe_label text := left(coalesce(nullif(btrim(input_device_label), ''), 'Устройство'), 80);
  saved_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if input_endpoint is null or input_endpoint not like 'https://%'
    or char_length(input_endpoint) not between 20 and 4096
    or char_length(coalesce(input_p256dh, '')) not between 20 and 512
    or char_length(coalesce(input_auth, '')) not between 8 and 256 then
    raise exception 'Invalid push subscription' using errcode = '22023';
  end if;

  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    select device.family_id, device.child_id, 'child'
    into own_family_id, own_child_id, own_role
    from public.child_devices device
    where device.auth_user_id = auth.uid() and device.revoked_at is null
    limit 1;
  else
    select member.family_id, child.id, 'parent'
    into own_family_id, own_child_id, own_role
    from public.family_members member
    join public.children child on child.family_id = member.family_id
    where member.user_id = auth.uid() and member.role = 'parent'
    limit 1;
  end if;

  if own_child_id is null then
    raise exception 'Connected family session required' using errcode = '42501';
  end if;

  insert into public.push_subscriptions as subscription (
    family_id, child_id, auth_user_id, recipient_role, endpoint, endpoint_hash,
    p256dh, auth_secret, device_label
  ) values (
    own_family_id, own_child_id, auth.uid(), own_role, input_endpoint,
    encode(digest(input_endpoint, 'sha256'), 'hex'), input_p256dh, input_auth, safe_label
  )
  on conflict (endpoint_hash) do update set
    p256dh = excluded.p256dh,
    auth_secret = excluded.auth_secret,
    device_label = excluded.device_label,
    active = true,
    updated_at = now(),
    last_seen_at = now()
  where subscription.auth_user_id = auth.uid()
  returning subscription.id into saved_id;

  if saved_id is null then
    raise exception 'This browser subscription belongs to another session' using errcode = '42501';
  end if;

  return query
  select subscription.id, subscription.recipient_role, subscription.active, subscription.updated_at
  from public.push_subscriptions subscription where subscription.id = saved_id;
end;
$$;

create or replace function public.disable_my_push_subscription(input_endpoint text)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  update public.push_subscriptions subscription
  set active = false, updated_at = now()
  where subscription.auth_user_id = auth.uid()
    and subscription.endpoint_hash = encode(digest(input_endpoint, 'sha256'), 'hex');
end;
$$;

create or replace function public.is_my_push_subscription_active(input_endpoint text)
returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select exists (
    select 1 from public.push_subscriptions subscription
    where subscription.auth_user_id = auth.uid()
      and subscription.endpoint_hash = encode(digest(input_endpoint, 'sha256'), 'hex')
      and subscription.active
  );
$$;

create or replace function public.list_my_push_devices()
returns table (id uuid, role text, device_label text, active boolean, updated_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select subscription.id, subscription.recipient_role, subscription.device_label,
    subscription.active, subscription.updated_at
  from public.push_subscriptions subscription
  where subscription.active
    and exists (
      select 1 from public.family_members member
      where member.family_id = subscription.family_id
        and member.user_id = auth.uid() and member.role = 'parent'
    )
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is false
  order by subscription.recipient_role, subscription.updated_at desc;
$$;

create or replace function public.revoke_family_push_device(input_subscription_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.push_subscriptions subscription
  set active = false, updated_at = now()
  where subscription.id = input_subscription_id
    and exists (
      select 1 from public.family_members member
      where member.family_id = subscription.family_id
        and member.user_id = auth.uid() and member.role = 'parent'
    )
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is false;
  if not found then
    raise exception 'Push device not found' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.queue_my_test_notification()
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  own_family_id uuid;
  own_child_id uuid;
  own_role text;
  queued_id uuid;
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    select device.family_id, device.child_id, 'child'
    into own_family_id, own_child_id, own_role
    from public.child_devices device
    where device.auth_user_id = auth.uid() and device.revoked_at is null limit 1;
  else
    select member.family_id, child.id, 'parent'
    into own_family_id, own_child_id, own_role
    from public.family_members member
    join public.children child on child.family_id = member.family_id
    where member.user_id = auth.uid() and member.role = 'parent' limit 1;
  end if;
  if own_child_id is null then
    raise exception 'Connected family session required' using errcode = '42501';
  end if;

  insert into public.notification_outbox (
    event_key, family_id, child_id, recipient_role, title, body, target_url, scheduled_for
  ) values (
    'test:' || auth.uid()::text || ':' || gen_random_uuid()::text,
    own_family_id, own_child_id, own_role,
    'Уведомления работают', 'Это проверочное сообщение от «Школьного помощника».', '/', now()
  ) returning id into queued_id;
  return queued_id;
end;
$$;

create or replace function public.enqueue_homework_parent_notification()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare child_name text;
begin
  if new.status = 'pending_review' and old.status in ('todo', 'needs_revision') then
    select child.display_name into child_name from public.children child where child.id = new.child_id;
    insert into public.notification_outbox (
      event_key, family_id, child_id, recipient_role, title, body, target_url, scheduled_for
    ) values (
      'homework-review:' || new.id::text || ':' || new.updated_at::text,
      new.family_id, new.child_id, 'parent',
      case when old.status = 'needs_revision' then 'Домашка отправлена повторно' else 'Домашка ждёт проверки' end,
      left(child_name || case when old.status = 'needs_revision' then ': задание повторно отправлено после доработки.' else ': задание отправлено на проверку.' end, 300),
      '/', now()
    ) on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger homework_enqueue_parent_push
after update of status on public.homework_assignments
for each row when (old.status is distinct from new.status)
execute function public.enqueue_homework_parent_notification();

create or replace function public.enqueue_backpack_parent_notification()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare child_name text;
begin
  if new.status = 'pending_review' and old.status = 'packing' then
    select child.display_name into child_name from public.children child where child.id = new.child_id;
    insert into public.notification_outbox (
      event_key, family_id, child_id, recipient_role, title, body, target_url, scheduled_for
    ) values (
      'backpack-review:' || new.id::text || ':' || new.updated_at::text,
      new.family_id, new.child_id, 'parent', 'Рюкзак собран',
      left(child_name || ': рюкзак собран и отправлен на проверку.', 300), '/', now()
    ) on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger backpack_enqueue_parent_push
after update of status on public.backpack_checklists
for each row when (old.status is distinct from new.status)
execute function public.enqueue_backpack_parent_notification();

create or replace function public.enqueue_book_parent_notification()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare child_name text;
begin
  if new.review_status = 'pending_review' and old.review_status is distinct from 'pending_review' then
    select child.display_name into child_name from public.children child where child.id = new.child_id;
    insert into public.notification_outbox (
      event_key, family_id, child_id, recipient_role, title, body, target_url, scheduled_for
    ) values (
      'book-review:' || new.id::text || ':' || new.updated_at::text,
      new.family_id, new.child_id, 'parent', 'Книга прочитана',
      left(child_name || ': дневник по книге «' || new.title || '» готов к проверке.', 300), '/', now()
    ) on conflict (event_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger books_enqueue_parent_push
after update of review_status on public.books
for each row when (old.review_status is distinct from new.review_status)
execute function public.enqueue_book_parent_notification();

create or replace function public.materialize_due_notifications(input_now timestamptz default now())
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  local_day date := (input_now at time zone 'Europe/Samara')::date;
  inserted_count integer := 0;
  affected integer := 0;
begin
  with due as (
    select preference.*,
      ((local_day::text || ' ' || preference.notify_at::text)::timestamp at time zone 'Europe/Samara') as scheduled_at
    from public.notification_preferences preference
    where preference.enabled and preference.kind <> 'unfinished_homework_parent'
  )
  insert into public.notification_outbox (
    event_key, family_id, child_id, recipient_role, title, body, target_url, scheduled_for
  )
  select
    due.kind || ':' || due.child_id::text || ':' || local_day::text,
    due.family_id, due.child_id, due.recipient_role,
    case due.kind
      when 'wake' then 'Пора вставать'
      when 'breakfast' then 'Время завтракать'
      when 'today_plan' then 'План на сегодня'
      when 'homework_start' then 'Пора за домашку'
      when 'homework_check_child' then 'Все уроки выполнены?'
      else 'Пора готовиться ко сну' end,
    case due.kind
      when 'wake' then 'Доброе утро! Начинаем новый день.'
      when 'breakfast' then 'Пора позавтракать перед делами.'
      when 'today_plan' then 'Посмотри расписание и проверь рюкзак.'
      when 'homework_start' then 'Открой «Домашку» и начни с первого задания.'
      when 'homework_check_child' then 'Проверь, все ли задания на сегодня готовы.'
      else 'Собираемся ко сну, чтобы завтра были силы.' end,
    '/', due.scheduled_at
  from due
  where due.scheduled_at between input_now - interval '2 minutes' and input_now + interval '1 minute'
  on conflict (event_key) do nothing;
  get diagnostics affected = row_count;
  inserted_count := inserted_count + affected;

  with due_parent as (
    select preference.*,
      ((local_day::text || ' ' || preference.notify_at::text)::timestamp at time zone 'Europe/Samara') as scheduled_at
    from public.notification_preferences preference
    where preference.enabled and preference.kind = 'unfinished_homework_parent'
      and exists (
        select 1 from public.homework_assignments homework
        where homework.family_id = preference.family_id
          and homework.child_id = preference.child_id
          and homework.due_on <= local_day
          and homework.status in ('todo', 'needs_revision')
      )
  )
  insert into public.notification_outbox (
    event_key, family_id, child_id, recipient_role, title, body, target_url, scheduled_for
  )
  select 'unfinished-homework:' || due_parent.child_id::text || ':' || local_day::text,
    due_parent.family_id, due_parent.child_id, 'parent', 'Осталась домашка',
    'К настроенному времени остались неподтверждённые задания.', '/', due_parent.scheduled_at
  from due_parent
  where due_parent.scheduled_at between input_now - interval '2 minutes' and input_now + interval '1 minute'
  on conflict (event_key) do nothing;
  get diagnostics affected = row_count;
  inserted_count := inserted_count + affected;

  with calendar as (
    select generated.day::date as occurs_on
    from generate_series((local_day - 1)::timestamp, (local_day + 2)::timestamp, interval '1 day') generated(day)
  ), regular_occurrences as (
    select club.id as club_id, club.family_id, club.child_id, club.title,
      calendar.occurs_on, club.starts_at, club.reminder_minutes
    from public.clubs club
    join calendar on extract(isodow from calendar.occurs_on)::smallint = club.weekday
    left join public.club_exceptions exception
      on exception.club_id = club.id and exception.original_day = calendar.occurs_on
    where club.active and club.reminder_enabled and exception.id is null
  ), moved_occurrences as (
    select club.id as club_id, club.family_id, club.child_id, club.title,
      exception.replacement_day as occurs_on, coalesce(exception.starts_at, club.starts_at) as starts_at,
      club.reminder_minutes
    from public.clubs club
    join public.club_exceptions exception on exception.club_id = club.id and exception.kind = 'rescheduled'
    where club.active and club.reminder_enabled and exception.replacement_day between local_day - 1 and local_day + 2
  ), occurrences as (
    select * from regular_occurrences union all select * from moved_occurrences
  ), due_clubs as (
    select occurrence.*,
      (((occurrence.occurs_on::text || ' ' || occurrence.starts_at::text)::timestamp at time zone 'Europe/Samara')
        - make_interval(mins => occurrence.reminder_minutes)) as scheduled_at
    from occurrences occurrence
  )
  insert into public.notification_outbox (
    event_key, family_id, child_id, recipient_role, title, body, target_url, scheduled_for
  )
  select 'club:' || due.club_id::text || ':' || due.occurs_on::text || ':' || due.starts_at::text,
    due.family_id, due.child_id, 'child', 'Скоро кружок',
    left(case when due.reminder_minutes = 0 then 'Скоро начнётся «' else 'Через ' || due.reminder_minutes || ' мин. начнётся «' end || due.title || '».', 300),
    '/', due.scheduled_at
  from due_clubs due
  where due.scheduled_at between input_now - interval '2 minutes' and input_now + interval '1 minute'
  on conflict (event_key) do nothing;
  get diagnostics affected = row_count;
  return inserted_count + affected;
end;
$$;

create or replace function public.claim_notification_outbox(input_limit integer default 50)
returns table (
  id uuid,
  event_key text,
  family_id uuid,
  child_id uuid,
  recipient_role text,
  title text,
  body text,
  target_url text,
  attempts smallint
)
language plpgsql security definer set search_path = public
as $$
begin
  update public.notification_outbox stuck
  set status = 'retry', next_attempt_at = now(), updated_at = now(),
    last_error = 'Delivery lease expired'
  where stuck.status = 'sending' and stuck.claimed_at < now() - interval '10 minutes';

  return query
  with candidates as (
    select queued.id
    from public.notification_outbox queued
    where queued.status in ('pending', 'retry')
      and queued.scheduled_for <= now() + interval '1 minute'
      and queued.next_attempt_at <= now()
    order by queued.scheduled_for, queued.created_at
    for update skip locked
    limit greatest(1, least(coalesce(input_limit, 50), 100))
  )
  update public.notification_outbox queued
  set status = 'sending', attempts = queued.attempts + 1,
    claimed_at = now(), updated_at = now()
  from candidates
  where queued.id = candidates.id
  returning queued.id, queued.event_key, queued.family_id, queued.child_id,
    queued.recipient_role, queued.title, queued.body, queued.target_url, queued.attempts;
end;
$$;

revoke all on function public.add_default_notification_preferences(uuid, uuid) from public;
revoke all on function public.seed_child_notification_preferences() from public;
revoke all on function public.get_my_notification_preferences() from public;
revoke all on function public.update_my_notification_preferences(jsonb) from public;
revoke all on function public.upsert_my_push_subscription(text, text, text, text) from public;
revoke all on function public.disable_my_push_subscription(text) from public;
revoke all on function public.is_my_push_subscription_active(text) from public;
revoke all on function public.list_my_push_devices() from public;
revoke all on function public.revoke_family_push_device(uuid) from public;
revoke all on function public.queue_my_test_notification() from public;
revoke all on function public.enqueue_homework_parent_notification() from public;
revoke all on function public.enqueue_backpack_parent_notification() from public;
revoke all on function public.enqueue_book_parent_notification() from public;
revoke all on function public.materialize_due_notifications(timestamptz) from public;
revoke all on function public.claim_notification_outbox(integer) from public;

grant execute on function public.get_my_notification_preferences() to authenticated;
grant execute on function public.update_my_notification_preferences(jsonb) to authenticated;
grant execute on function public.upsert_my_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.disable_my_push_subscription(text) to authenticated;
grant execute on function public.is_my_push_subscription_active(text) to authenticated;
grant execute on function public.list_my_push_devices() to authenticated;
grant execute on function public.revoke_family_push_device(uuid) to authenticated;
grant execute on function public.queue_my_test_notification() to authenticated;
grant execute on function public.materialize_due_notifications(timestamptz) to service_role;
grant execute on function public.claim_notification_outbox(integer) to service_role;
