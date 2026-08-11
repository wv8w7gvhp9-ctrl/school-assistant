import { useCallback, useEffect, useState } from 'react'
import { normalizeVapidPublicKey, pushEnableFailureMessage, safePushErrorCode, type PushEnableStage } from '../domain/notifications'
import { supabase, vapidPublicKey } from '../lib/supabase'
import { useOnlineStatus } from './NetworkStatus'

type PushState =
  | 'checking'
  | 'unsupported'
  | 'install_required'
  | 'not_configured'
  | 'idle'
  | 'enabling'
  | 'enabled'
  | 'denied'
  | 'disabling'
  | 'error'

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isStandalone() {
  const iosNavigator = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || iosNavigator.standalone === true
}

function deviceLabel() {
  if (isIosDevice()) return 'iPhone или iPad'
  if (/Android/i.test(navigator.userAgent)) return 'Android'
  return 'Компьютер'
}

async function saveSubscription(subscription: PushSubscription) {
  if (!supabase) throw new Error('Supabase is not configured')
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('Incomplete push subscription')
  const { error } = await supabase.rpc('upsert_my_push_subscription', {
    input_endpoint: json.endpoint,
    input_p256dh: json.keys.p256dh,
    input_auth: json.keys.auth,
    input_device_label: deviceLabel(),
  })
  if (error) throw error
}

export function PushNotificationSettings({ role, onChanged }: { role: 'parent' | 'child'; onChanged?: () => void }) {
  const online = useOnlineStatus()
  const [state, setState] = useState<PushState>('checking')
  const [message, setMessage] = useState('')
  const [testing, setTesting] = useState(false)

  const inspect = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState('unsupported')
      return
    }
    if (isIosDevice() && !isStandalone()) {
      setState('install_required')
      return
    }
    if (!vapidPublicKey || !normalizeVapidPublicKey(vapidPublicKey)) {
      setState('not_configured')
      return
    }
    if (Notification.permission === 'denied') {
      setState('denied')
      return
    }
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) {
      setState('idle')
      return
    }
    if (!online) {
      setState('enabled')
      return
    }
    if (!supabase) {
      setState('error')
      return
    }
    const { data, error } = await supabase.rpc('is_my_push_subscription_active', { input_endpoint: subscription.endpoint })
    if (error) throw error
    setState(data === true ? 'enabled' : 'idle')
  }, [online])

  useEffect(() => {
    let cancelled = false
    void inspect().catch(() => {
      if (!cancelled) {
        setState('error')
        setMessage('Не удалось проверить подписку. Обновите страницу и попробуйте ещё раз.')
      }
    })
    return () => { cancelled = true }
  }, [inspect])

  async function enable() {
    if (!online || !vapidPublicKey) return
    const applicationServerKey = normalizeVapidPublicKey(vapidPublicKey)
    if (!applicationServerKey) {
      setState('not_configured')
      return
    }
    setState('enabling')
    setMessage('')
    let stage: PushEnableStage = 'permission'
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'idle')
        return
      }
      stage = 'service-worker'
      const registration = await navigator.serviceWorker.ready
      stage = 'existing-subscription'
      const existing = await registration.pushManager.getSubscription()
      stage = 'subscription'
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      })
      try {
        stage = 'server'
        await saveSubscription(subscription)
      } catch (error) {
        if (!existing) await subscription.unsubscribe()
        throw error
      }
      setState('enabled')
      setMessage('Уведомления включены на этом устройстве.')
      onChanged?.()
    } catch (error) {
      console.error(`Push enable failed at ${stage}`, error)
      setState('error')
      setMessage(pushEnableFailureMessage(stage, safePushErrorCode(error)))
    }
  }

  async function disable() {
    if (!online || !supabase) return
    setState('disabling')
    setMessage('')
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        const { error } = await supabase.rpc('disable_my_push_subscription', { input_endpoint: subscription.endpoint })
        if (error) throw error
        await subscription.unsubscribe()
      }
      setState('idle')
      setMessage('Уведомления отключены на этом устройстве.')
      onChanged?.()
    } catch {
      setState('error')
      setMessage('Не удалось отключить подписку. Подключитесь к интернету и повторите попытку.')
    }
  }

  async function sendTest() {
    if (!online || !supabase) return
    setTesting(true)
    setMessage('')
    const { error } = await supabase.rpc('queue_my_test_notification')
    setTesting(false)
    setMessage(error
      ? 'Не удалось поставить проверочное уведомление в очередь.'
      : 'Проверочное уведомление поставлено в очередь. Обычно оно приходит в течение минуты.')
  }

  return <div className={`push-device-control ${state}`}>
    {state === 'checking' && <p className="auth-loading" role="status">Проверяем уведомления…</p>}
    {state === 'unsupported' && <p className="notification-banner warning" role="status"><strong>Уведомления не поддерживаются</strong><span>Откройте приложение в актуальном Safari, Chrome или Edge.</span></p>}
    {state === 'install_required' && <p className="notification-banner info" role="status"><strong>Сначала установите приложение</strong><span>В Safari нажмите «Поделиться» → «На экран Домой», затем откройте «Школьный помощник» с иконки.</span></p>}
    {state === 'not_configured' && <p className="notification-banner warning" role="status"><strong>Отправка ещё не настроена</strong><span>Публичный ключ уведомлений нужно добавить в настройки размещения.</span></p>}
    {state === 'denied' && <p className="notification-banner error" role="alert"><strong>Уведомления заблокированы</strong><span>Разрешите уведомления для «Школьного помощника» в настройках устройства, затем вернитесь сюда.</span></p>}
    {state === 'idle' && <><p className="notification-banner warning"><strong>Уведомления выключены</strong><span>{role === 'child' ? 'Включите напоминания на этом устройстве ребёнка.' : 'Включите события ребёнка на этом устройстве родителя.'}</span></p><button type="button" className="primary-button" disabled={!online} onClick={() => void enable()}>{online ? 'Включить уведомления' : 'Нужен интернет'}</button></>}
    {state === 'enabling' && <button type="button" className="primary-button" disabled>Включаем…</button>}
    {state === 'enabled' && <><p className="notification-banner success" role="status"><strong>Уведомления включены</strong><span>Это устройство зарегистрировано для роли «{role === 'child' ? 'Ребёнок' : 'Родитель'}».</span></p><div className="push-device-actions"><button type="button" className="secondary-button" disabled={!online || testing} onClick={() => void sendTest()}>{testing ? 'Отправляем…' : 'Проверить уведомление'}</button><button type="button" className="text-button" disabled={!online} onClick={() => void disable()}>Отключить на этом устройстве</button></div></>}
    {state === 'disabling' && <button type="button" className="secondary-button" disabled>Отключаем…</button>}
    {state === 'error' && <button type="button" className="secondary-button" disabled={!online} onClick={() => void inspect()}>Проверить снова</button>}
    {message && <p className={state === 'error' ? 'auth-message error' : 'auth-message success'} role={state === 'error' ? 'alert' : 'status'}>{message}</p>}
  </div>
}
