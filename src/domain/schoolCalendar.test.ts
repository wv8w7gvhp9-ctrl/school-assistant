import { describe, expect, it } from 'vitest'
import { academicYearLabel, formatCalendarPeriod, isCalendarProposal } from './schoolCalendar'

describe('предложение календаря учебного года', () => {
  it('форматирует период без смещения даты', () => {
    expect(formatCalendarPeriod({
      label: 'Осенние каникулы', reason: 'vacation', starts_on: '2026-10-26', ends_on: '2026-11-03',
    })).toBe('26 октября 2026 г. — 3 ноября 2026 г.')
  })

  it('показывает понятную подпись учебного года', () => {
    expect(academicYearLabel('2026-09-01')).toBe('2026–2027')
  })

  it('не принимает неподтверждённые данные с небезопасной ссылкой', () => {
    expect(isCalendarProposal({ id: '1', status: 'pending', source_url: 'javascript:alert(1)', periods: [] })).toBe(false)
  })

  it('принимает только полный ответ сервера с безопасными ссылками и датами', () => {
    expect(isCalendarProposal({
      id: 'proposal-1', status: 'pending', document_title: 'Рекомендации', document_number: 'ОК-1',
      published_on: '2026-07-07', source_url: 'https://www.consultant.ru/document/1/',
      official_index_url: 'https://example.edu/official', created_at: '2026-07-07T10:00:00Z', reviewed_at: null,
      periods: [{ label: 'Осенние каникулы', starts_on: '2026-10-26', ends_on: '2026-11-03', reason: 'vacation' }],
    })).toBe(true)
  })
})
