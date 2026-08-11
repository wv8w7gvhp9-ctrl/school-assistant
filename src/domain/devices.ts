export type ChildDevice = {
  id: string
  device_label: string
  connected_at: string
  revoked_at: string | null
  notifications_enabled: boolean
}

export function childDeviceName(label: string) {
  return label.trim() || 'Устройство ребёнка'
}

export function childDeviceStatus(device: Pick<ChildDevice, 'revoked_at' | 'notifications_enabled'>) {
  if (device.revoked_at) return 'Отозвано'
  return device.notifications_enabled ? 'Подключено · уведомления включены' : 'Подключено'
}

export function formatChildDeviceDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'дата неизвестна'
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Samara',
  }).format(date)
}
