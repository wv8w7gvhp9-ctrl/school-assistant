import { describe, expect, it } from 'vitest'
import { parseThings, schoolYearDefaults, validateLessonDraft } from './schedule'

describe('расписание', () => {
  it('объединяет повторяющиеся вещи и очищает пробелы', () => {
    expect(parseThings(' тетрадь, ручка, тетрадь, , пенал ')).toEqual(['тетрадь', 'ручка', 'пенал'])
  })

  it('не позволяет окончить урок раньше его начала', () => {
    expect(validateLessonDraft({ subject: 'Математика', lessonOrder: '1', startsAt: '09:00', endsAt: '08:45' }))
      .toBe('Время окончания должно быть позже времени начала.')
  })

  it('создаёт границы учебного года', () => {
    expect(schoolYearDefaults(new Date(2026, 7, 5))).toEqual({ startsOn: '2026-09-01', endsOn: '2027-05-31' })
  })
})
