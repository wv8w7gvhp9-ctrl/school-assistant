export type CloudLesson = {
  weekday: number
  lesson_order: number
  starts_at: string
  ends_at: string
  subject_title: string
  things: string[]
  status: 'regular' | 'cancelled' | 'replacement' | 'extra'
}

export type SchoolDayReason = 'weekend_override' | 'holiday' | 'vacation'

export type SchoolDayStatus = {
  is_school_day: boolean
  reason: SchoolDayReason | null
}

export const schoolDayMessages: Record<SchoolDayReason, { title: string; description: string }> = {
  weekend_override: { title: 'Сегодня выходной', description: 'Уроков нет. Можно отдохнуть и почитать.' },
  holiday: { title: 'Сегодня праздник', description: 'Уроков нет. Хорошего праздника!' },
  vacation: { title: 'Сейчас каникулы', description: 'Уроков нет. Приятного отдыха!' },
}

export function schoolDayMessage(reason: SchoolDayReason | null | undefined) {
  return reason ? schoolDayMessages[reason] : null
}

export function lessonStatusLabel(lesson: Pick<CloudLesson, 'lesson_order' | 'status'>): string {
  if (lesson.status === 'cancelled') return 'Урок отменён'
  if (lesson.status === 'replacement') return 'Замена'
  if (lesson.status === 'extra') return `Дополнительный урок ${lesson.lesson_order}`
  return `Урок ${lesson.lesson_order}`
}

export function isoDateForWeekday(todayIso: string, todayWeekday: number, weekday: number): string {
  const date = new Date(`${todayIso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + weekday - todayWeekday)
  return date.toISOString().slice(0, 10)
}

export const childWeekdays = [
  { value: 1, short: 'Пн', full: 'Понедельник' },
  { value: 2, short: 'Вт', full: 'Вторник' },
  { value: 3, short: 'Ср', full: 'Среда' },
  { value: 4, short: 'Чт', full: 'Четверг' },
  { value: 5, short: 'Пт', full: 'Пятница' },
]

export function mondayFirstWeekday(date: Date): number {
  const nativeDay = date.getDay()
  return nativeDay === 0 ? 1 : nativeDay
}

export function timeRange(lesson: Pick<CloudLesson, 'starts_at' | 'ends_at'>): string {
  return `${lesson.starts_at.slice(0, 5)}–${lesson.ends_at.slice(0, 5)}`
}
