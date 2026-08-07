/// <reference types="npm:@types/node@22.15.3" />
// @ts-types="npm:@types/web-push@3.6.4"
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2.112.0'

type OutboxItem = {
  id: string
  event_key: string
  family_id: string
  child_id: string
  recipient_role: 'parent' | 'child'
  title: string
  body: string
  target_url: string
  attempts: number
}

type StoredSubscription = {
  id: string
  endpoint: string
  p256dh: string
  auth_secret: string
}

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' }

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function pushFailure(error: unknown) {
  const failure = error as { statusCode?: number; message?: string }
  return {
    statusCode: failure.statusCode ?? 0,
    message: (failure.message ?? 'Push provider error').slice(0, 500),
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  try {
    const cronSecret = requiredEnv('CRON_SECRET')
    if (request.headers.get('x-cron-secret') !== cronSecret) {
      return new Response('Unauthorized', { status: 401 })
    }

    const supabaseUrl = requiredEnv('SUPABASE_URL')
    const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
    const vapidSubject = requiredEnv('VAPID_SUBJECT')
    const vapidPublicKey = requiredEnv('VAPID_PUBLIC_KEY')
    const vapidPrivateKey = requiredEnv('VAPID_PRIVATE_KEY')
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const updateOutbox = async (id: string, values: Record<string, unknown>) => {
      const { error } = await supabase.from('notification_outbox').update(values).eq('id', id)
      if (error) throw error
    }

    const { error: materializeError } = await supabase.rpc('materialize_due_notifications', {
      input_now: new Date().toISOString(),
    })
    if (materializeError) throw materializeError

    const { data, error: claimError } = await supabase.rpc('claim_notification_outbox', { input_limit: 50 })
    if (claimError) throw claimError
    const items = (data ?? []) as OutboxItem[]
    let sent = 0
    let noTargets = 0
    let retried = 0
    let failed = 0

    for (const item of items) {
      const { data: subscriptionData, error: subscriptionError } = await supabase
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth_secret')
        .eq('family_id', item.family_id)
        .eq('child_id', item.child_id)
        .eq('recipient_role', item.recipient_role)
        .eq('active', true)
      if (subscriptionError) throw subscriptionError
      const subscriptions = (subscriptionData ?? []) as StoredSubscription[]

      if (subscriptions.length === 0) {
        await updateOutbox(item.id, {
          status: 'no_targets',
          last_error: 'No active subscription for recipient role',
          updated_at: new Date().toISOString(),
        })
        noTargets += 1
        continue
      }

      const payload = JSON.stringify({
        title: item.title,
        body: item.body,
        url: item.target_url,
        tag: item.event_key,
      })
      let delivered = false
      const errors: string[] = []

      for (const subscription of subscriptions) {
        try {
          await webpush.sendNotification({
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret },
          }, payload, { TTL: 300, urgency: 'normal' })
          delivered = true
        } catch (error) {
          const failure = pushFailure(error)
          errors.push(`${failure.statusCode || 'unknown'}: ${failure.message}`)
          if (failure.statusCode === 404 || failure.statusCode === 410) {
            const { error: disableError } = await supabase.from('push_subscriptions').update({
              active: false,
              updated_at: new Date().toISOString(),
            }).eq('id', subscription.id)
            if (disableError) throw disableError
          }
        }
      }

      if (delivered) {
        await updateOutbox(item.id, {
          status: 'sent',
          sent_at: new Date().toISOString(),
          last_error: errors.length ? errors.join('; ').slice(0, 1000) : null,
          updated_at: new Date().toISOString(),
        })
        sent += 1
      } else {
        const finalFailure = item.attempts >= 5
        await updateOutbox(item.id, {
          status: finalFailure ? 'failed' : 'retry',
          next_attempt_at: new Date(Date.now() + Math.min(item.attempts * 5, 30) * 60_000).toISOString(),
          last_error: errors.join('; ').slice(0, 1000) || 'No delivery succeeded',
          updated_at: new Date().toISOString(),
        })
        if (finalFailure) failed += 1
        else retried += 1
      }
    }

    return new Response(JSON.stringify({ claimed: items.length, sent, noTargets, retried, failed }), {
      status: 200,
      headers: jsonHeaders,
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Push dispatcher failed')
    return new Response(JSON.stringify({ error: 'Push dispatcher failed' }), {
      status: 500,
      headers: jsonHeaders,
    })
  }
})
