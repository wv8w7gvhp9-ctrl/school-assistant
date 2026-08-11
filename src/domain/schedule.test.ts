import { describe, expect, it } from 'vitest'
import {
  formatNonSchoolPeriod,
  groupNonSchoolDays,
  parseThings,
  schoolYearDefaults,
  validateLessonDraft,
  validateNonSchoolPeriod,
  validateOptionalTimeRange,
} from './schedule'

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

  it('требует обе границы времени для замены', () => {
    expect(validateOptionalTimeRange('08:00', '')).toBe('Укажите и начало, и окончание замены.')
  })

  it('не разрешает каникулы за границами выбранного учебного года', () => {
    expect(validateNonSchoolPeriod(
      { startsOn: '2027-05-25', endsOn: '2027-06-02' },
      { starts_on: '2026-09-01', ends_on: '2027-05-31' },
    )).toBe('Период должен находиться внутри выбранного учебного года.')
  })

  it('объединяет соседние дни одного типа и не смешивает праздник с каникулами', () => {
    expect(groupNonSchoolDays([
      { day: '2026-11-03', reason: 'vacation' },
      { day: '2026-11-01', reason: 'vacation' },
      { day: '2026-11-04', reason: 'holiday' },
      { day: '2026-11-02', reason: 'vacation' },
    ])).toEqual([
      { startsOn: '2026-11-01', endsOn: '2026-11-03', reason: 'vacation', dayCount: 3 },
      { startsOn: '2026-11-04', endsOn: '2026-11-04', reason: 'holiday', dayCount: 1 },
    ])
  })

  it('форматирует одиночный неучебный день без смещения даты', () => {
    expect(formatNonSchoolPeriod({ startsOn: '2026-11-04', endsOn: '2026-11-04' })).toContain('4 ноября 2026')
  })
})
