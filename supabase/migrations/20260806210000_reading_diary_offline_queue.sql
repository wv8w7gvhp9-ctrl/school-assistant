-- Идемпотентное сохранение читательского дневника после работы без сети.
-- Сервер проверяет детское устройство, семью, поля дневника и версию книги.

alter table public.offline_mutation_receipts
  drop constraint offline_mutation_receipts_mutation_type_check;
alter table public.offline_mutation_receipts
  add constraint offline_mutation_receipts_mutation_type_check
  check (mutation_type in ('submit_homework', 'set_backpack_item', 'submit_backpack', 'save_reading_diary'));

create or replace function public.get_my_books_v2()
returns table (
  id uuid,
  title text,
  author text,
  status text,
  started_on date,
  finished_on date,
  main_characters text,
  summary text,
  rating smallint,
  review_status text,
  updated_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select book.id, book.title, book.author, book.status, book.started_on, book.finished_on,
    book.main_characters, book.summary, book.rating, book.review_status, book.updated_at
  from public.books book
  join public.child_devices device
    on device.child_id = book.child_id
   and device.family_id = book.family_id
  where device.auth_user_id = auth.uid()
    and device.revoked_at is null
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true
  order by case book.status when 'reading' then 0 when 'assigned' then 1 else 2 end,
    book.created_at desc;
$$;

create or replace function public.sync_my_reading_diary(
  input_book_id uuid,
  input_mutation_id uuid,
  input_expected_updated_at timestamptz,
  input_status text,
  input_started_on date,
  input_finished_on date,
  input_main_characters text,
  input_summary text,
  input_rating smallint
)
returns table (
  id uuid,
  status text,
  review_status text,
  updated_at timestamptz,
  outcome text
)
language plpgsql security definer set search_path = public
as $$
declare
  current_status text;
  current_review_status text;
  current_started_on date;
  current_finished_on date;
  current_main_characters text;
  current_summary text;
  current_rating smallint;
  current_updated_at timestamptz;
  current_family_id uuid;
  current_child_id uuid;
  desired_status text;
  desired_review_status text;
  desired_main_characters text;
  desired_summary text;
  receipt_user_id uuid;
  receipt_type text;
  receipt_entity_id uuid;
  receipt_payload jsonb;
  requested_payload jsonb;
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true then
    raise exception 'Anonymous child session required' using errcode = '42501';
  end if;
  if input_book_id is null or input_mutation_id is null then
    raise exception 'Book and mutation are required' using errcode = '22023';
  end if;
  if input_status is null or input_status not in ('assigned', 'reading', 'finished') then
    raise exception 'Unsupported book status' using errcode = '22023';
  end if;
  if input_finished_on is not null
    and input_started_on is not null
    and input_finished_on < input_started_on then
    raise exception 'Finished date is before started date' using errcode = '22023';
  end if;
  if input_status = 'finished' and input_finished_on is null then
    raise exception 'Finished date is required' using errcode = '22023';
  end if;
  if input_rating is not null and (input_rating < 1 or input_rating > 5) then
    raise exception 'Rating is outside allowed range' using errcode = '22023';
  end if;

  desired_main_characters := left(coalesce(input_main_characters, ''), 2000);
  desired_summary := left(coalesce(input_summary, ''), 6000);
  requested_payload := jsonb_build_object(
    'expected_updated_at', to_jsonb(input_expected_updated_at),
    'status', input_status,
    'started_on', to_jsonb(input_started_on),
    'finished_on', to_jsonb(input_finished_on),
    'main_characters', desired_main_characters,
    'summary', desired_summary,
    'rating', input_rating
  );

  perform pg_advisory_xact_lock(hashtextextended(input_mutation_id::text, 0));

  select receipt.auth_user_id, receipt.mutation_type, receipt.entity_id, receipt.mutation_payload
  into receipt_user_id, receipt_type, receipt_entity_id, receipt_payload
  from public.offline_mutation_receipts receipt
  where receipt.mutation_id = input_mutation_id;

  if receipt_user_id is not null then
    if receipt_user_id = auth.uid()
      and receipt_type = 'save_reading_diary'
      and receipt_entity_id = input_book_id
      and receipt_payload = requested_payload then
      id := input_book_id;
      status := input_status;
      review_status := case when input_status = 'finished' then 'pending_review' else 'not_submitted' end;
      updated_at := null;
      outcome := 'already_applied';
      return next;
      return;
    end if;

    id := input_book_id;
    status := null;
    review_status := null;
    updated_at := null;
    outcome := 'conflict';
    return next;
    return;
  end if;

  select book.status, book.review_status, book.started_on, book.finished_on,
    book.main_characters, book.summary, book.rating, book.updated_at,
    book.family_id, book.child_id
  into current_status, current_review_status, current_started_on, current_finished_on,
    current_main_characters, current_summary, current_rating, current_updated_at,
    current_family_id, current_child_id
  from public.books book
  where book.id = input_book_id
    and exists (
      select 1 from public.child_devices device
      where device.child_id = book.child_id
        and device.family_id = book.family_id
        and device.auth_user_id = auth.uid()
        and device.revoked_at is null
    )
  for update;

  if current_child_id is null then
    id := input_book_id;
    status := null;
    review_status := null;
    updated_at := null;
    outcome := 'missing';
    return next;
    return;
  end if;

  desired_status := case when current_review_status = 'approved' then 'finished' else input_status end;
  desired_review_status := case
    when current_review_status = 'approved' then 'approved'
    when input_status = 'finished' then 'pending_review'
    else 'not_submitted'
  end;

  if input_expected_updated_at is null
    or current_updated_at is distinct from input_expected_updated_at then
    if current_status = desired_status
      and current_review_status = desired_review_status
      and current_started_on is not distinct from input_started_on
      and current_finished_on is not distinct from input_finished_on
      and current_main_characters = desired_main_characters
      and current_summary = desired_summary
      and current_rating is not distinct from input_rating then
      insert into public.offline_mutation_receipts (
        mutation_id, auth_user_id, family_id, child_id, mutation_type, entity_id, mutation_payload
      ) values (
        input_mutation_id, auth.uid(), current_family_id, current_child_id,
        'save_reading_diary', input_book_id, requested_payload
      );
      id := input_book_id;
      status := current_status;
      review_status := current_review_status;
      updated_at := current_updated_at;
      outcome := 'already_satisfied';
      return next;
      return;
    end if;

    id := input_book_id;
    status := current_status;
    review_status := current_review_status;
    updated_at := current_updated_at;
    outcome := 'conflict';
    return next;
    return;
  end if;

  update public.books book
  set status = desired_status,
    started_on = input_started_on,
    finished_on = input_finished_on,
    main_characters = desired_main_characters,
    summary = desired_summary,
    rating = input_rating,
    review_status = desired_review_status,
    updated_at = now()
  where book.id = input_book_id
  returning book.status, book.review_status, book.updated_at
  into status, review_status, updated_at;

  insert into public.offline_mutation_receipts (
    mutation_id, auth_user_id, family_id, child_id, mutation_type, entity_id, mutation_payload
  ) values (
    input_mutation_id, auth.uid(), current_family_id, current_child_id,
    'save_reading_diary', input_book_id, requested_payload
  );

  id := input_book_id;
  outcome := 'applied';
  return next;
end;
$$;

revoke all on function public.get_my_books_v2() from public;
revoke all on function public.sync_my_reading_diary(uuid, uuid, timestamptz, text, date, date, text, text, smallint) from public;
grant execute on function public.get_my_books_v2() to authenticated;
grant execute on function public.sync_my_reading_diary(uuid, uuid, timestamptz, text, date, date, text, text, smallint) to authenticated;
