-- Книги и читательский дневник: назначение родителем, заполнение ребёнком и подтверждение за три звезды.

alter table public.star_events drop constraint star_events_source_type_check;
alter table public.star_events add constraint star_events_source_type_check check (source_type in ('homework', 'book'));

create table public.books (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  author text not null check (char_length(btrim(author)) between 1 and 160),
  status text not null default 'assigned' check (status in ('assigned', 'reading', 'finished')),
  started_on date,
  finished_on date,
  main_characters text not null default '' check (char_length(main_characters) <= 2000),
  summary text not null default '' check (char_length(summary) <= 6000),
  rating smallint check (rating between 1 and 5),
  review_status text not null default 'not_submitted' check (review_status in ('not_submitted', 'pending_review', 'approved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (finished_on is null or started_on is null or finished_on >= started_on),
  check (status <> 'finished' or finished_on is not null)
);

alter table public.books enable row level security;

create policy "parents manage assigned books" on public.books for all to authenticated
using (public.is_parent_of_family(family_id)) with check (public.is_parent_of_family(family_id));

grant select, insert, delete on public.books to authenticated;
grant update (title, author, updated_at) on public.books to authenticated;

create or replace function public.get_my_books()
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
  review_status text
)
language sql stable security definer set search_path = public
as $$
  select book.id, book.title, book.author, book.status, book.started_on, book.finished_on,
    book.main_characters, book.summary, book.rating, book.review_status
  from public.books book
  join public.child_devices device on device.child_id = book.child_id and device.family_id = book.family_id
  where device.auth_user_id = auth.uid()
    and device.revoked_at is null
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true
  order by case book.status when 'reading' then 0 when 'assigned' then 1 else 2 end, book.created_at desc;
$$;

create or replace function public.update_my_reading_diary(
  input_book_id uuid,
  input_status text,
  input_started_on date,
  input_finished_on date,
  input_main_characters text,
  input_summary text,
  input_rating smallint
)
returns table (id uuid, status text, review_status text)
language plpgsql security definer set search_path = public
as $$
declare
  saved_id uuid;
  saved_status text;
  saved_review_status text;
begin
  if input_status not in ('assigned', 'reading', 'finished') then
    raise exception 'Unsupported book status' using errcode = '22023';
  end if;
  if input_finished_on is not null and input_started_on is not null and input_finished_on < input_started_on then
    raise exception 'Finished date is before started date' using errcode = '22023';
  end if;
  if input_status = 'finished' and input_finished_on is null then
    raise exception 'Finished date is required' using errcode = '22023';
  end if;
  if input_rating is not null and (input_rating < 1 or input_rating > 5) then
    raise exception 'Rating is outside allowed range' using errcode = '22023';
  end if;

  update public.books book
  set
    status = case when book.review_status = 'approved' then 'finished' else input_status end,
    started_on = input_started_on,
    finished_on = input_finished_on,
    main_characters = left(coalesce(input_main_characters, ''), 2000),
    summary = left(coalesce(input_summary, ''), 6000),
    rating = input_rating,
    review_status = case
      when book.review_status = 'approved' then 'approved'
      when input_status = 'finished' then 'pending_review'
      else 'not_submitted'
    end,
    updated_at = now()
  where book.id = input_book_id
    and exists (
      select 1 from public.child_devices device
      where device.child_id = book.child_id
        and device.family_id = book.family_id
        and device.auth_user_id = auth.uid()
        and device.revoked_at is null
    )
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true
  returning book.id, book.status, book.review_status into saved_id, saved_status, saved_review_status;

  if saved_id is null then
    raise exception 'Book diary cannot be updated' using errcode = '42501';
  end if;

  id := saved_id;
  status := saved_status;
  review_status := saved_review_status;
  return next;
end;
$$;

create or replace function public.review_finished_book(input_book_id uuid)
returns table (id uuid, review_status text, stars_awarded smallint)
language plpgsql security definer set search_path = public
as $$
declare
  reviewed_id uuid;
  reviewed_family_id uuid;
  reviewed_child_id uuid;
  awarded smallint := 0;
begin
  update public.books book
  set review_status = 'approved', updated_at = now()
  where book.id = input_book_id
    and book.status = 'finished'
    and book.review_status = 'pending_review'
    and public.is_parent_of_family(book.family_id)
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is false
  returning book.id, book.family_id, book.child_id into reviewed_id, reviewed_family_id, reviewed_child_id;

  if reviewed_id is null then
    raise exception 'Book cannot be reviewed' using errcode = '42501';
  end if;

  insert into public.star_events (family_id, child_id, source_type, source_id, stars, reason)
  values (reviewed_family_id, reviewed_child_id, 'book', reviewed_id, 3, 'Подтверждённая прочитанная книга')
  on conflict (source_type, source_id) do nothing;
  if found then awarded := 3; end if;

  id := reviewed_id;
  review_status := 'approved';
  stars_awarded := awarded;
  return next;
end;
$$;

revoke all on function public.get_my_books() from public;
revoke all on function public.update_my_reading_diary(uuid, text, date, date, text, text, smallint) from public;
revoke all on function public.review_finished_book(uuid) from public;
grant execute on function public.get_my_books() to authenticated;
grant execute on function public.update_my_reading_diary(uuid, text, date, date, text, text, smallint) to authenticated;
grant execute on function public.review_finished_book(uuid) to authenticated;
