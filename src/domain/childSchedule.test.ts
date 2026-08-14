import { describe, expect, it } from 'vitest'
import { canShiftScheduleWeek, initialScheduleDate, isoDateForWeekday, isSameScheduleWeek, lessonStatusLabel, mondayFirstWeekday, scheduleDateLabel, scheduleWeekDates, scheduleWeekLabel, schoolDayMessage, shiftScheduleWeek, timeRange, type AcademicYearBounds } from './childSchedule'

const academicYear: AcademicYearBounds = { id: 'year-2026', starts_on: '2026-09-01', ends_on: '2027-05-31' }

describe('детское расписание', () => {
  it('переносит воскресенье на понедельник для выбора расписания', () => {
    expect(mondayFirstWeekday(new Date(2026, 7, 2))).toBe(1)
  })

  it('показывает время урока без секунд', () => {
    expect(timeRange({ starts_at: '08:00:00', ends_at: '08:40:00' })).toBe('08:00–08:40')
  })

  it('вычисляет дату выбранного учебного дня в текущей неделе', () => {
    expect(isoDateForWeekday('2026-08-05', 3, 1)).toBe('2026-08-03')
  })

  it('вычисляет дату выбранного учебного дня на следующей неделе', () => {
    expect(isoDateForWeekday('2026-08-05', 3, 8)).toBe('2026-08-10')
  })

  it('объясняет ребёнку каникулы без технических терминов', () => {
    expect(schoolDayMessage('vacation')).toEqual({ title: 'Сейчас каникулы', description: 'Уроков нет. Приятного отдыха!' })
  })

  it('понятно обозначает разовый дополнительный урок', () => {
    expect(lessonStatusLabel({ lesson_order: 6, status: 'extra' })).toBe('Дополнительный урок 6')
  })

  it('до начала учебного года открывает первую доступную учебную дату', () => {
    expect(initialScheduleDate('2026-08-14', academicYear)).toBe('2026-09-01')
  })

  it('после конца учебного года открывает последний будний день', () => {
    expect(initialScheduleDate('2027-06-10', academicYear)).toBe('2027-05-31')
  })

  it('не даёт выбрать августовский день вне нового учебного года', () => {
    expect(scheduleWeekDates('2026-09-01', academicYear).map(({ date, enabled }) => ({ date, enabled }))).toEqual([
      { date: '2026-08-31', enabled: false },
      { date: '2026-09-01', enabled: true },
      { date: '2026-09-02', enabled: true },
      { date: '2026-09-03', enabled: true },
      { date: '2026-09-04', enabled: true },
    ])
  })

  it('листит недели внутри учебного года и сохраняет выбранный день недели', () => {
    expect(shiftScheduleWeek('2026-09-01', 1, academicYear)).toBe('2026-09-08')
    expect(isSameScheduleWeek('2026-09-01', '2026-09-04')).toBe(true)
    expect(canShiftScheduleWeek('2026-09-01', -1, academicYear)).toBe(false)
    expect(canShiftScheduleWeek('2026-09-01', 1, academicYear)).toBe(true)
  })

  it('показывает ребёнку конкретный диапазон недели и выбранную дату', () => {
    expect(scheduleWeekLabel('2026-09-01', academicYear)).toBe('1 сентября — 4 сентября 2026 г.')
    expect(scheduleDateLabel('2026-09-01')).toBe('вторник, 1 сентября 2026 г.')
  })
})
