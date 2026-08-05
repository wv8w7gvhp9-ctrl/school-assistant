export type LessonDraft = {
  subject: string
  lessonOrder: string
  startsAt: string
  endsAt: string
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
