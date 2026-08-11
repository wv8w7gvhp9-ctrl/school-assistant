import { useCallback, useEffect, useState } from 'react'
import { childDeviceName, childDeviceStatus, formatChildDeviceDate, type ChildDevice } from '../domain/devices'
import { supabase } from '../lib/supabase'
import { useOnlineStatus } from './NetworkStatus'

export function ParentChildDevices() {
  const online = useOnlineStatus()
  const [devices, setDevices] = useState<ChildDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    setError('')
    const { data, error: loadError } = await supabase.rpc('list_my_child_devices')
    if (loadError) setError('Не удалось загрузить устройства ребёнка. Проверьте интернет и повторите попытку.')
    else setDevices((data as ChildDevice[] | null) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function revoke(deviceId: string) {
    if (!supabase || !online || busyId) return
    setBusyId(deviceId)
    setError('')
    setMessage('')
    const { error: revokeError } = await supabase.rpc('revoke_child_device', { input_device_id: deviceId })
    setBusyId(null)
    if (revokeError) {
      setError('Не удалось отключить устройство. Проверьте интернет и повторите попытку.')
      return
    }
    setConfirmingId(null)
    setMessage('Устройство отключено. Оно больше не получит новые семейные данные и уведомления.')
    await load()
  }

  return <section className="parent-child-devices">
    <div className="parent-section-heading"><div><h2>Устройства ребёнка</h2><p>Здесь показаны устройства, подключённые коротким кодом.</p></div></div>
    {loading && <p className="auth-loading" role="status">Загружаем устройства…</p>}
    {!loading && devices.length === 0 && !error && <p className="parent-empty">У ребёнка пока нет подключённых устройств.</p>}
    {!loading && devices.length > 0 && <div className="child-device-list">{devices.map((device) => {
      const revoked = Boolean(device.revoked_at)
      return <article className={`child-device-row${revoked ? ' revoked' : ''}`} key={device.id}>
        <div className="child-device-heading"><div><strong>{childDeviceName(device.device_label)}</strong><span>{childDeviceStatus(device)}</span></div>{!revoked && <button type="button" className="text-button" disabled={!online || busyId !== null} onClick={() => { setConfirmingId(device.id); setError(''); setMessage('') }}>{online ? 'Отключить' : 'Нужен интернет'}</button>}</div>
        <time dateTime={device.connected_at}>Подключено {formatChildDeviceDate(device.connected_at)}</time>
        {revoked && device.revoked_at && <time dateTime={device.revoked_at}>Отозвано {formatChildDeviceDate(device.revoked_at)}</time>}
        {confirmingId === device.id && <div className="parent-confirm" role="alertdialog" aria-labelledby={`revoke-device-${device.id}`}><p id={`revoke-device-${device.id}`}>Отключить это устройство? Оно перестанет получать новые семейные данные и уведомления. Уже сохранённые на нём офлайн-данные нельзя удалить дистанционно.</p><div><button type="button" className="secondary-button" disabled={busyId !== null} onClick={() => setConfirmingId(null)}>Оставить</button><button type="button" className="danger-button" disabled={busyId !== null || !online} onClick={() => void revoke(device.id)}>{busyId === device.id ? 'Отключаем…' : 'Отключить устройство'}</button></div></div>}
      </article>
    })}</div>}
    {error && <div className="auth-message error retry-message" role="alert"><p>{error}</p><button type="button" className="text-button" disabled={!online} onClick={() => void load()}>{online ? 'Повторить' : 'Нужен интернет'}</button></div>}
    {message && <p className="auth-message success" role="status">{message}</p>}
  </section>
}
