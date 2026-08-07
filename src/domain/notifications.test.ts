import { describe, expect, it } from 'vitest'
import {
  defaultNotificationPreferences,
  normalizeNotificationTime,
  notificationEventKey,
  samaraDateTimeParts,
  urlBase64ToUint8Array,
} from './notifications'

describe('планирование уведомлений', () => {
  it('использует утверждённые начальные времена и отдельного получателя', () => {
    expect(defaultNotificationPreferences.map(({ kind, notify_at, recipient_role }) => ({ kind, notify_at, recipient_role }))).toEqual([
      { kind: 'wake', notify_at: '06:30:00', recipient_role: 'child' },
      { kind: 'breakfast', notify_at: '07:00:00', recipient_role: 'child' },
      { kind: 'today_plan', notify_at: '07:30:00', recipient_role: 'child' },
      { kind: 'homework_start', notify_at: '15:00:00', recipient_role: 'child' },
      { kind: 'homework_check_child', notify_at: '20:00:00', recipient_role: 'child' },
      { kind: 'bedtime', notify_at: '21:30:00', recipient_role: 'child' },
      { kind: 'unfinished_homework_parent', notify_at: '20:00:00', recipient_role: 'parent' },
    ])
  })

  it('считает дату и время строго в Europe/Samara', () => {
    expect(samaraDateTimeParts(new Date('2026-08-05T20:30:00.000Z'))).toEqual({ date: '2026-08-06', time: '00:30' })
    expect(samaraDateTimeParts(new Date('2026-12-31T19:59:00.000Z'))).toEqual({ date: '2026-12-31', time: '23:59' })
  })

  it('создаёт стабильный ключ события и не принимает неверное время', () => {
    expect(notificationEventKey('wake', 'child-1', '2026-08-06')).toBe('wake:child-1:2026-08-06')
    expect(normalizeNotificationTime('06:30:00')).toBe('06:30')
    expect(normalizeNotificationTime('24:10')).toBeNull()
  })

  it('преобразует публичный VAPID-ключ без добавления секрета', () => {
    expect([...urlBase64ToUint8Array('AQIDBA')]).toEqual([1, 2, 3, 4])
  })
})
