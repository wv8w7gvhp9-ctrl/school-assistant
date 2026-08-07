export type NotificationPreferenceKind =
  | 'wake'
  | 'breakfast'
  | 'today_plan'
  | 'homework_start'
  | 'homework_check_child'
  | 'bedtime'
  | 'unfinished_homework_parent'

export type PushEnableStage = 'permission' | 'service-worker' | 'subscription' | 'server'

export type NotificationPreference = {
  kind: NotificationPreferenceKind
  enabled: boolean
  notify_at: string
  recipient_role: 'parent' | 'child'
}

export const notificationPreferenceLabels: Record<NotificationPreferenceKind, string> = {
  wake: 'Пора вставать',
  breakfast: 'Время завтракать',
  today_plan: 'Расписание и рюкзак',
  homework_start: 'Приступить к домашке',
  homework_check_child: 'Все уроки выполнены?',
  bedtime: 'Готовиться ко сну',
  unfinished_homework_parent: 'Родителю: осталась домашка',
}

export const defaultNotificationPreferences: NotificationPreference[] = [
  { kind: 'wake', enabled: true, notify_at: '06:30:00', recipient_role: 'child' },
  { kind: 'breakfast', enabled: true, notify_at: '07:00:00', recipient_role: 'child' },
  { kind: 'today_plan', enabled: true, notify_at: '07:30:00', recipient_role: 'child' },
  { kind: 'homework_start', enabled: true, notify_at: '15:00:00', recipient_role: 'child' },
  { kind: 'homework_check_child', enabled: true, notify_at: '20:00:00', recipient_role: 'child' },
  { kind: 'bedtime', enabled: true, notify_at: '21:30:00', recipient_role: 'child' },
  { kind: 'unfinished_homework_parent', enabled: true, notify_at: '20:00:00', recipient_role: 'parent' },
]

export function normalizeNotificationTime(value: string) {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return `${match[1]}:${match[2]}`
}

export function urlBase64ToArrayBuffer(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = globalThis.atob(base64)
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

export function safePushErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return 'unknown'
  const candidate = error as { code?: unknown; name?: unknown }
  for (const value of [candidate.code, candidate.name]) {
    if (typeof value === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(value)) return value
  }
  return 'unknown'
}

export function pushEnableFailureMessage(stage: PushEnableStage, code: string) {
  const suffix = code === 'unknown' ? '' : ` Код: ${code}.`
  if (stage === 'permission') return `Браузер не выдал разрешение на уведомления.${suffix}`
  if (stage === 'service-worker') return `Не удалось подготовить приложение к уведомлениям.${suffix}`
  if (stage === 'subscription') return `Safari не создал системную push-подписку.${suffix}`
  return `Сервер не сохранил подписку этого устройства.${suffix}`
}

export function samaraDateTimeParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Samara',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  }
}

export function notificationEventKey(kind: NotificationPreferenceKind | 'club', childId: string, occurrence: string) {
  return `${kind}:${childId}:${occurrence}`
}
