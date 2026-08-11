import { describe, expect, it } from 'vitest'
import { isoDateForWeekday, mondayFirstWeekday, schoolDayMessage, timeRange } from './childSchedule'

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
})
