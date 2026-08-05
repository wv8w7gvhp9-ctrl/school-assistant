import { describe, expect, it } from 'vitest'
import { mondayFirstWeekday, timeRange } from './childSchedule'

describe('детское расписание', () => {
  it('переносит воскресенье на понедельник для выбора расписания', () => {
    expect(mondayFirstWeekday(new Date(2026, 7, 2))).toBe(1)
  })

  it('показывает время урока без секунд', () => {
    expect(timeRange({ starts_at: '08:00:00', ends_at: '08:40:00' })).toBe('08:00–08:40')
  })
})
