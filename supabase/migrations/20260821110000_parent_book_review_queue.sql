-- Защищённая родительская очередь прочитанных книг.
-- Клиент не передаёт family_id или child_id: функция выводит доступную семью
-- только из текущей подтверждённой родительской сессии.

create or replace function public.get_parent_book_reviews()
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
language sql
stable
security definer
set search_path = public
as $$
  select
    book.id,
    book.title,
    book.author,
    book.status,
    book.started_on,
    book.finished_on,
    book.main_characters,
    book.summary,
    book.rating,
    book.review_status,
    book.updated_at
  from public.books book
  where book.status = 'finished'
    and book.review_status = 'pending_review'
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is false
    and exists (
      select 1
      from public.family_members member
      where member.family_id = book.family_id
        and member.user_id = auth.uid()
        and member.role = 'parent'
    )
  order by book.updated_at;
$$;

revoke all on function public.get_parent_book_reviews() from public;
grant execute on function public.get_parent_book_reviews() to authenticated;
