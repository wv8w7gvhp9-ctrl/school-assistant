import { describe, expect, it } from 'vitest'
import { clubTimeRange, isoWeekday, nextActiveOccurrence, nextDateForWeekday, reminderTime, validateClubDraft, type ClubOccurrence } from './clubs'

describe('кружки', () => {
  it('проверяет время окончания занятия', () => {
    expect(validateClubDraft({ title: 'Робототехника', weekday: '3', startsAt: '17:00', endsAt: '16:00', things: '', reminderEnabled: true, reminderMinutes: '30' })).toBe('Время окончания должно быть позже времени начала.')
  })

  it('проверяет допустимое время напоминания', () => {
    expect(validateClubDraft({ title: 'Робототехника', weekday: '3', startsAt: '17:00', endsAt: '18:00', things: '', reminderEnabled: true, reminderMinutes: '-1' })).toBe('Напоминание должно быть от 0 до 1440 минут.')
  })

  it('вычисляет точное время напоминания', () => {
    expect(reminderTime('17:00:00', 30)).toBe('16:30')
    expect(reminderTime('00:15:00', 30)).toBe('23:45')
  })

  it('показывает интервал без секунд', () => {
    expect(clubTimeRange('17:00:00', '18:00:00')).toBe('17:00–18:00')
    expect(clubTimeRange('17:00:00', null)).toBe('17:00')
  })

  it('пропускает отменённое занятие при поиске ближайшего', () => {
    const base: Omit<ClubOccurrence, 'occurs_on' | 'status'> = { club_id: '1', title: 'Робототехника', starts_at: '17:00:00', ends_at: null, things: [], reminder_enabled: true, reminder_minutes: 30, replacement_day: null }
    const occurrences: ClubOccurrence[] = [
      { ...base, occurs_on: '2026-08-05', status: 'cancelled' },
      { ...base, occurs_on: '2026-08-12', status: 'regular' },
    ]
    expect(nextActiveOccurrence(occurrences)?.occurs_on).toBe('2026-08-12')
  })

  it('определяет день недели даты без зависимости от устройства', () => {
    expect(isoWeekday('2026-08-05')).toBe(3)
    expect(isoWeekday('2026-08-09')).toBe(7)
  })

  it('находит ближайшую дату регулярного кружка', () => {
    expect(nextDateForWeekday('2026-08-05', 5)).toBe('2026-08-07')
    expect(nextDateForWeekday('2026-08-05', 3)).toBe('2026-08-05')
  })
})
