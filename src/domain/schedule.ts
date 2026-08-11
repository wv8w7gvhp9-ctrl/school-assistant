export type LessonDraft = {
  subject: string
  lessonOrder: string
  startsAt: string
  endsAt: string
}

export type NonSchoolReason = 'weekend_override' | 'holiday' | 'vacation'

export type NonSchoolDay = {
  day: string
  reason: NonSchoolReason
}

export type NonSchoolPeriod = {
  startsOn: string
  endsOn: string
  reason: NonSchoolReason
  dayCount: number
}

export const nonSchoolReasonLabels: Record<NonSchoolReason, string> = {
  weekend_override: 'Выходной',
  holiday: 'Праздник',
  vacation: 'Каникулы',
}

export function parseThings(value: string): string[] {
  return [...new Set(value.split(',').map((thing) => thing.trim()).filter(Boolean))]
}

export function validateLessonDraft(draft: LessonDraft): string | null {
  if (!draft.subject.trim()) return 'Введите название предмета.'

  const lessonOrder = Number(draft.lessonOrder)
  if (!Number.isInteger(lessonOrder) || lessonOrder < 1) return 'Укажите порядковый номер урока.'
  if (!draft.startsAt || !draft.endsAt) return 'Укажите время начала и окончания урока.'
  if (draft.endsAt <= draft.startsAt) return 'Время окончания должно быть позже времени начала.'

  return null
}

export function validateOptionalTimeRange(startsAt: string, endsAt: string): string | null {
  if (Boolean(startsAt) !== Boolean(endsAt)) return 'Укажите и начало, и окончание замены.'
  if (startsAt && endsAt && endsAt <= startsAt) return 'Время окончания должно быть позже времени начала.'
  return null
}

export function schoolYearDefaults(now = new Date()): { startsOn: string; endsOn: string } {
  const startYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1
  return { startsOn: `${startYear}-09-01`, endsOn: `${startYear + 1}-05-31` }
}

export function validateNonSchoolPeriod(
  period: { startsOn: string; endsOn: string },
  academicYear: { starts_on: string; ends_on: string },
): string | null {
  if (!period.startsOn || !period.endsOn) return 'Укажите начало и окончание периода.'
  if (period.endsOn < period.startsOn) return 'Дата окончания не может быть раньше даты начала.'
  if (period.startsOn < academicYear.starts_on || period.endsOn > academicYear.ends_on) {
    return 'Период должен находиться внутри выбранного учебного года.'
  }
  return null
}

function nextIsoDay(day: string) {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

export function groupNonSchoolDays(days: NonSchoolDay[]): NonSchoolPeriod[] {
  const sorted = [...days].sort((left, right) => left.day.localeCompare(right.day))
  const periods: NonSchoolPeriod[] = []
  for (const day of sorted) {
    const previous = periods.at(-1)
    if (previous && previous.reason === day.reason && nextIsoDay(previous.endsOn) === day.day) {
      previous.endsOn = day.day
      previous.dayCount += 1
    } else {
      periods.push({ startsOn: day.day, endsOn: day.day, reason: day.reason, dayCount: 1 })
    }
  }
  return periods
}

export function formatNonSchoolPeriod(period: Pick<NonSchoolPeriod, 'startsOn' | 'endsOn'>) {
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })
  const start = formatter.format(new Date(`${period.startsOn}T00:00:00Z`))
  if (period.startsOn === period.endsOn) return start
  return `${start} — ${formatter.format(new Date(`${period.endsOn}T00:00:00Z`))}`
}
