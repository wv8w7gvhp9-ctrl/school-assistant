export type ClubDraft = {
  title: string
  weekday: string
  startsAt: string
  endsAt: string
  things: string
  reminderEnabled: boolean
  reminderMinutes: string
}

export type CloudClub = {
  id: string
  title: string
  weekday: number
  starts_at: string
  ends_at: string | null
  things: string[]
  reminder_enabled: boolean
  reminder_minutes: number
  active: boolean
}

export type ClubOccurrence = {
  club_id: string
  title: string
  occurs_on: string
  starts_at: string
  ends_at: string | null
  things: string[]
  reminder_enabled: boolean
  reminder_minutes: number
  status: 'regular' | 'cancelled' | 'rescheduled_from' | 'rescheduled'
  replacement_day: string | null
}

export const clubWeekdays = [
  { value: 1, short: 'Пн', full: 'Понедельник' },
  { value: 2, short: 'Вт', full: 'Вторник' },
  { value: 3, short: 'Ср', full: 'Среда' },
  { value: 4, short: 'Чт', full: 'Четверг' },
  { value: 5, short: 'Пт', full: 'Пятница' },
  { value: 6, short: 'Сб', full: 'Суббота' },
  { value: 7, short: 'Вс', full: 'Воскресенье' },
]

export function validateClubDraft(draft: ClubDraft) {
  if (!draft.title.trim()) return 'Введите название кружка.'
  if (!draft.startsAt) return 'Укажите время начала.'
  if (draft.endsAt && draft.endsAt <= draft.startsAt) return 'Время окончания должно быть позже времени начала.'
  const reminderMinutes = Number(draft.reminderMinutes)
  if (draft.reminderEnabled && (!Number.isInteger(reminderMinutes) || reminderMinutes < 0 || reminderMinutes > 1440)) return 'Напоминание должно быть от 0 до 1440 минут.'
  return null
}

export function reminderTime(startsAt: string, minutesBefore: number) {
  const [hours, minutes] = startsAt.slice(0, 5).split(':').map(Number)
  const totalMinutes = (hours * 60 + minutes - minutesBefore + 1440) % 1440
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`
}

export function clubTimeRange(startsAt: string, endsAt: string | null) {
  return endsAt ? `${startsAt.slice(0, 5)}–${endsAt.slice(0, 5)}` : startsAt.slice(0, 5)
}

export function nextActiveOccurrence(occurrences: ClubOccurrence[]) {
  return occurrences.find((occurrence) => occurrence.status === 'regular' || occurrence.status === 'rescheduled') ?? null
}

export function isoWeekday(isoDate: string) {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay()
  return day === 0 ? 7 : day
}

export function nextDateForWeekday(fromIso: string, weekday: number) {
  const current = isoWeekday(fromIso)
  const date = new Date(`${fromIso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + (weekday - current + 7) % 7)
  return date.toISOString().slice(0, 10)
}
