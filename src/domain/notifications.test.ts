import { describe, expect, it } from 'vitest'
import {
  defaultNotificationPreferences,
  normalizeVapidPublicKey,
  normalizeNotificationTime,
  notificationEventKey,
  pushEnableFailureMessage,
  safePushErrorCode,
  samaraDateTimeParts,
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

  it('передаёт Safari стандартный Base64URL VAPID-ключ без собственного декодирования', () => {
    const key = `B${'a'.repeat(85)}_`
    expect(normalizeVapidPublicKey(`  ${key}  `)).toBe(key)
    expect(normalizeVapidPublicKey(`VAPID_PUBLIC_KEY=${key}`)).toBe(key)
    expect(normalizeVapidPublicKey(`${key}=`)).toBeNull()
    expect(normalizeVapidPublicKey(`B${'a'.repeat(84)}+_`)).toBeNull()
  })

  it('показывает безопасный этап и код ошибки push без технического текста', () => {
    expect(safePushErrorCode({ name: 'AbortError', message: 'endpoint-secret-value' })).toBe('AbortError')
    expect(safePushErrorCode({ code: '42501', message: 'private server detail' })).toBe('42501')
    expect(safePushErrorCode({ code: 'unsafe code with spaces' })).toBe('unknown')
    expect(pushEnableFailureMessage('subscription', 'AbortError')).toBe('Safari не создал системную push-подписку. Код: AbortError.')
    expect(pushEnableFailureMessage('existing-subscription', 'InvalidCharacterError')).toBe('Safari не смог проверить прежнюю push-подписку. Код: InvalidCharacterError.')
  })
})
