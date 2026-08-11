import { describe, expect, it } from 'vitest'
import { childDeviceName, childDeviceStatus, formatChildDeviceDate } from './devices'

describe('подключённые устройства ребёнка', () => {
  it('не показывает пустое техническое название', () => {
    expect(childDeviceName('  ')).toBe('Устройство ребёнка')
  })

  it('различает активное и отозванное устройство текстом', () => {
    expect(childDeviceStatus({ revoked_at: null, notifications_enabled: true })).toBe('Подключено · уведомления включены')
    expect(childDeviceStatus({ revoked_at: '2026-08-11T10:00:00Z', notifications_enabled: false })).toBe('Отозвано')
  })

  it('форматирует дату по Самаре и безопасно обрабатывает неверную дату', () => {
    expect(formatChildDeviceDate('2026-08-11T20:30:00Z')).toContain('12 августа 2026')
    expect(formatChildDeviceDate('не дата')).toBe('дата неизвестна')
  })
})
