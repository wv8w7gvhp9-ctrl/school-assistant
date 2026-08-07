import { useCallback, useEffect, useState } from 'react'
import {
  defaultNotificationPreferences,
  normalizeNotificationTime,
  notificationPreferenceLabels,
  type NotificationPreference,
  type NotificationPreferenceKind,
} from '../domain/notifications'
import { supabase } from '../lib/supabase'
import { PushNotificationSettings } from './PushNotificationSettings'

type PushDevice = {
  id: string
  role: 'parent' | 'child'
  device_label: string
  active: boolean
  updated_at: string
}

const knownKinds = new Set(defaultNotificationPreferences.map((item) => item.kind))

export function ParentNotificationSettings() {
  const [preferences, setPreferences] = useState<NotificationPreference[]>([])
  const [devices, setDevices] = useState<PushDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const loadDevices = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase.rpc('list_my_push_devices')
    setDevices((data as PushDevice[] | null) ?? [])
  }, [])

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    setError('')
    const [{ data: preferenceData, error: preferenceError }] = await Promise.all([
      supabase.rpc('get_my_notification_preferences'),
      loadDevices(),
    ])
    if (preferenceError) setError('Не удалось загрузить настройки уведомлений. Повторите попытку.')
    else {
      const safe = ((preferenceData as NotificationPreference[] | null) ?? []).filter((item) => knownKinds.has(item.kind))
      setPreferences(safe)
    }
    setLoading(false)
  }, [loadDevices])

  useEffect(() => { void load() }, [load])

  function update(kind: NotificationPreferenceKind, values: Partial<NotificationPreference>) {
    setPreferences((current) => current.map((item) => item.kind === kind ? { ...item, ...values } : item))
    setMessage('')
  }

  async function save() {
    if (!supabase) return
    const invalid = preferences.some((item) => !normalizeNotificationTime(item.notify_at))
    if (invalid) {
      setError('Проверьте время напоминаний.')
      return
    }
    setSaving(true)
    setError('')
    setMessage('')
    const payload = preferences.map((item) => ({ kind: item.kind, enabled: item.enabled, notify_at: normalizeNotificationTime(item.notify_at) }))
    const { error: saveError } = await supabase.rpc('update_my_notification_preferences', { input_preferences: payload })
    setSaving(false)
    if (saveError) setError('Не удалось сохранить настройки. Проверьте интернет и повторите попытку.')
    else setMessage('Расписание уведомлений сохранено. Будущие напоминания пересчитаны.')
  }

  async function revokeDevice(deviceId: string) {
    if (!supabase) return
    setError('')
    const { error: revokeError } = await supabase.rpc('revoke_family_push_device', { input_subscription_id: deviceId })
    if (revokeError) setError('Не удалось отключить устройство.')
    else {
      setMessage('Подписка устройства отозвана.')
      await loadDevices()
    }
  }

  return <section className="parent-notifications">
    <div className="parent-section-heading"><div><h2>Уведомления</h2><p>Время указано по Самаре. Настройки меняет только родитель.</p></div></div>
    <h3>Это устройство родителя</h3>
    <PushNotificationSettings role="parent" onChanged={() => void loadDevices()} />
    <h3>Расписание напоминаний</h3>
    {loading && <p className="auth-loading" role="status">Загружаем настройки…</p>}
    {!loading && preferences.length === 0 && !error && <p className="parent-empty">Настройки пока не созданы.</p>}
    {!loading && preferences.length > 0 && <div className="notification-preference-list">{preferences.map((preference) => <div className="notification-preference-row" key={preference.kind}>
      <label className="switch-row"><input type="checkbox" checked={preference.enabled} onChange={(event) => update(preference.kind, { enabled: event.target.checked })} /><span><strong>{notificationPreferenceLabels[preference.kind]}</strong><small>{preference.recipient_role === 'child' ? 'Получит ребёнок' : 'Получит родитель'}</small></span></label>
      <label><span>Время</span><input type="time" value={normalizeNotificationTime(preference.notify_at) ?? ''} disabled={!preference.enabled} onChange={(event) => update(preference.kind, { notify_at: event.target.value })} /></label>
    </div>)}</div>}
    {!loading && preferences.length > 0 && <button type="button" className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? 'Сохраняем…' : 'Сохранить уведомления'}</button>}
    <h3>Подключённые устройства</h3>
    {devices.length === 0 ? <p className="parent-empty">Активных push-подписок пока нет.</p> : <div className="push-device-list">{devices.map((device) => <div className="push-device-row" key={device.id}><div><strong>{device.device_label}</strong><span>{device.role === 'child' ? 'Устройство ребёнка' : 'Устройство родителя'} · обновлено {new Date(device.updated_at).toLocaleDateString('ru-RU')}</span></div><button type="button" className="text-button" onClick={() => void revokeDevice(device.id)}>Отозвать</button></div>)}</div>}
    {error && <p className="auth-message error" role="alert">{error}</p>}
    {message && <p className="auth-message success" role="status">{message}</p>}
  </section>
}
