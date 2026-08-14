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

export type AcademicYearBounds = {
  id: string
  starts_on: string
  ends_on: string
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

export function addIsoDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function isoWeekday(iso: string): number {
  const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay()
  return weekday === 0 ? 7 : weekday
}

export function mondayIsoForDate(iso: string): string {
  return addIsoDays(iso, 1 - isoWeekday(iso))
}

function weekdayDateWithinRange(date: string, bounds: AcademicYearBounds) {
  const weekday = isoWeekday(date)
  return weekday <= 5 && date >= bounds.starts_on && date <= bounds.ends_on
}

export function initialScheduleDate(todayIso: string, bounds: AcademicYearBounds): string {
  const candidate = todayIso < bounds.starts_on ? bounds.starts_on : todayIso > bounds.ends_on ? bounds.ends_on : todayIso
  if (weekdayDateWithinRange(candidate, bounds)) return candidate

  const weekday = isoWeekday(candidate)
  const followingMonday = addIsoDays(candidate, 8 - weekday)
  if (weekdayDateWithinRange(followingMonday, bounds)) return followingMonday

  const previousFriday = addIsoDays(candidate, 5 - weekday)
  if (weekdayDateWithinRange(previousFriday, bounds)) return previousFriday
  return candidate
}

export function scheduleWeekDates(selectedDate: string, bounds: AcademicYearBounds) {
  const monday = mondayIsoForDate(selectedDate)
  return childWeekdays.map((day) => {
    const date = addIsoDays(monday, day.value - 1)
    return { ...day, date, enabled: date >= bounds.starts_on && date <= bounds.ends_on }
  })
}

export function canShiftScheduleWeek(selectedDate: string, direction: -1 | 1, bounds: AcademicYearBounds): boolean {
  const targetMonday = addIsoDays(mondayIsoForDate(selectedDate), direction * 7)
  const targetFriday = addIsoDays(targetMonday, 4)
  return targetFriday >= bounds.starts_on && targetMonday <= bounds.ends_on
}

export function shiftScheduleWeek(selectedDate: string, direction: -1 | 1, bounds: AcademicYearBounds): string {
  if (!canShiftScheduleWeek(selectedDate, direction, bounds)) return selectedDate
  const targetMonday = addIsoDays(mondayIsoForDate(selectedDate), direction * 7)
  const preferredDate = addIsoDays(targetMonday, Math.min(isoWeekday(selectedDate), 5) - 1)
  if (weekdayDateWithinRange(preferredDate, bounds)) return preferredDate
  return scheduleWeekDates(targetMonday, bounds).find((day) => day.enabled)?.date ?? selectedDate
}

export function isSameScheduleWeek(firstIso: string, secondIso: string): boolean {
  return mondayIsoForDate(firstIso) === mondayIsoForDate(secondIso)
}

function shortDateLabel(iso: string, includeYear = false) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    ...(includeYear ? { year: 'numeric' as const } : {}),
  }).format(new Date(`${iso}T00:00:00Z`))
}

export function scheduleWeekLabel(selectedDate: string, bounds: AcademicYearBounds): string {
  const availableDays = scheduleWeekDates(selectedDate, bounds).filter((day) => day.enabled)
  const first = availableDays[0]?.date ?? selectedDate
  const last = availableDays.at(-1)?.date ?? selectedDate
  const crossesYear = first.slice(0, 4) !== last.slice(0, 4)
  return `${shortDateLabel(first, crossesYear)} — ${shortDateLabel(last, true)}`
}

export function scheduleDateLabel(iso: string, isToday = false): string {
  const formatted = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(`${iso}T00:00:00Z`))
  return `${isToday ? 'Сегодня, ' : ''}${formatted}`
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
