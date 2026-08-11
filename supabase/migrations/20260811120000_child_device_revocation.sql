-- Родительское управление подключёнными устройствами ребёнка.
-- Отзыв закрывает серверный доступ детской сессии и отключает её push-подписки.

create or replace function public.list_my_child_devices()
returns table (
  id uuid,
  device_label text,
  connected_at timestamptz,
  revoked_at timestamptz,
  notifications_enabled boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) then
    raise exception 'Parent session required' using errcode = '42501';
  end if;

  return query
  select
    device.id,
    coalesce(
      (
        select subscription.device_label
        from public.push_subscriptions subscription
        where subscription.auth_user_id = device.auth_user_id
          and subscription.recipient_role = 'child'
        order by subscription.last_seen_at desc
        limit 1
      ),
      'Устройство ребёнка'
    ),
    device.connected_at,
    device.revoked_at,
    exists (
      select 1
      from public.push_subscriptions subscription
      where subscription.auth_user_id = device.auth_user_id
        and subscription.recipient_role = 'child'
        and subscription.active
    )
  from public.child_devices device
  where exists (
    select 1
    from public.family_members member
    where member.family_id = device.family_id
      and member.user_id = auth.uid()
      and member.role = 'parent'
  )
  order by device.revoked_at nulls first, device.connected_at desc;
end;
$$;

create or replace function public.revoke_child_device(input_device_id uuid)
returns table (id uuid, revoked_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_device public.child_devices%rowtype;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true) then
    raise exception 'Parent session required' using errcode = '42501';
  end if;

  select device.*
  into target_device
  from public.child_devices device
  where device.id = input_device_id
    and exists (
      select 1
      from public.family_members member
      where member.family_id = device.family_id
        and member.user_id = auth.uid()
        and member.role = 'parent'
    )
  for update;

  if not found then
    raise exception 'Child device not found' using errcode = '42501';
  end if;

  if target_device.revoked_at is null then
    update public.child_devices device
    set revoked_at = now()
    where device.id = target_device.id
    returning device.revoked_at into target_device.revoked_at;

    update public.push_subscriptions subscription
    set active = false, updated_at = now()
    where subscription.family_id = target_device.family_id
      and subscription.auth_user_id = target_device.auth_user_id
      and subscription.recipient_role = 'child'
      and subscription.active;
  end if;

  return query select target_device.id, target_device.revoked_at;
end;
$$;

revoke all on function public.list_my_child_devices() from public;
revoke all on function public.revoke_child_device(uuid) from public;
grant execute on function public.list_my_child_devices() to authenticated;
grant execute on function public.revoke_child_device(uuid) to authenticated;
