-- Повторное подключение того же детского устройства может сохранить прежний
-- браузерный PushSubscription. Безопасно переносим только неактивную подписку
-- от отозванной сессии того же ребёнка в той же семье.

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
  endpoint_digest text;
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

  endpoint_digest := encode(digest(input_endpoint, 'sha256'), 'hex');

  if own_role = 'child' then
    update public.push_subscriptions subscription
    set auth_user_id = auth.uid(),
      p256dh = input_p256dh,
      auth_secret = input_auth,
      device_label = safe_label,
      active = true,
      updated_at = now(),
      last_seen_at = now()
    where subscription.endpoint_hash = endpoint_digest
      and subscription.family_id = own_family_id
      and subscription.child_id = own_child_id
      and subscription.recipient_role = 'child'
      and subscription.active is false
      and exists (
        select 1
        from public.child_devices previous_device
        where previous_device.auth_user_id = subscription.auth_user_id
          and previous_device.family_id = own_family_id
          and previous_device.child_id = own_child_id
          and previous_device.revoked_at is not null
      )
    returning subscription.id into saved_id;
  end if;

  if saved_id is null then
    insert into public.push_subscriptions as subscription (
      family_id, child_id, auth_user_id, recipient_role, endpoint, endpoint_hash,
      p256dh, auth_secret, device_label
    ) values (
      own_family_id, own_child_id, auth.uid(), own_role, input_endpoint,
      endpoint_digest, input_p256dh, input_auth, safe_label
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
  end if;

  if saved_id is null then
    raise exception 'This browser subscription belongs to another session' using errcode = '42501';
  end if;

  return query
  select subscription.id, subscription.recipient_role, subscription.active, subscription.updated_at
  from public.push_subscriptions subscription where subscription.id = saved_id;
end;
$$;

revoke all on function public.upsert_my_push_subscription(text, text, text, text) from public;
grant execute on function public.upsert_my_push_subscription(text, text, text, text) to authenticated;
