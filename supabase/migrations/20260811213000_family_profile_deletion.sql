-- Полное удаление семейного профиля родителем.
-- Родительская auth-запись сохраняется: после удаления можно создать новую семью.
-- Дочерние семейные данные удаляются каскадно; таблицы со ссылкой subject_id
-- через ON DELETE RESTRICT очищаются заранее внутри той же транзакции.

create or replace function public.delete_my_family_profile(input_confirmation text)
returns table (deleted_family_id uuid, deleted_child_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is true then
    raise exception 'Parent session is required' using errcode = '42501';
  end if;

  if upper(btrim(coalesce(input_confirmation, ''))) <> 'УДАЛИТЬ' then
    raise exception 'Deletion confirmation is invalid' using errcode = '22023';
  end if;

  select parent_member.family_id, child_profile.id
    into deleted_family_id, deleted_child_id
  from public.family_members as parent_member
  join public.families as household on household.id = parent_member.family_id
  join public.children as child_profile on child_profile.family_id = household.id
  where parent_member.user_id = current_user_id
    and parent_member.role = 'parent'
  order by child_profile.created_at
  limit 1
  for update of household, child_profile;

  if deleted_family_id is null or deleted_child_id is null then
    raise exception 'Parent family was not found' using errcode = '42501';
  end if;

  -- Эти строки ссылаются на subjects через ON DELETE RESTRICT.
  delete from public.homework_assignments as assignment
  where assignment.family_id = deleted_family_id;

  delete from public.lesson_exceptions as lesson_exception
  where lesson_exception.family_id = deleted_family_id;

  delete from public.weekly_lessons as lesson
  where lesson.family_id = deleted_family_id;

  delete from public.families as household
  where household.id = deleted_family_id;

  if not found then
    raise exception 'Family deletion failed' using errcode = 'P0001';
  end if;

  return next;
end;
$$;

comment on function public.delete_my_family_profile(text) is
  'Deletes the authenticated non-anonymous parent family and all family-owned data after explicit confirmation.';

revoke all on function public.delete_my_family_profile(text) from public, anon;
grant execute on function public.delete_my_family_profile(text) to authenticated;
