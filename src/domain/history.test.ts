import { describe, expect, it } from 'vitest'
import {
  academicHistoryFilename,
  academicHistoryToCsv,
  filterAcademicHistory,
  formatAcademicYear,
  historyStatusLabel,
  type AcademicHistoryEvent,
} from './history'

const events: AcademicHistoryEvent[] = [
  {
    event_key: 'homework:1', category: 'homework', occurred_on: '2026-09-03', occurred_at: '2026-09-03T10:00:00Z',
    title: 'Русский язык', detail: 'Упражнение 5', status: 'approved', stars: null,
  },
  {
    event_key: 'book:1', category: 'book', occurred_on: '2026-10-04', occurred_at: '2026-10-04T10:00:00Z',
    title: 'Сказка', detail: 'Автор', status: 'finished:pending_review', stars: null,
  },
  {
    event_key: 'star:1', category: 'stars', occurred_on: '2026-10-04', occurred_at: '2026-10-04T10:01:00Z',
    title: 'Награда', detail: '', status: 'book', stars: 3,
  },
]

describe('история учебного года', () => {
  it('фильтрует единый список по разделу', () => {
    expect(filterAcademicHistory(events, 'Все')).toHaveLength(3)
    expect(filterAcademicHistory(events, 'Книги').map((event) => event.event_key)).toEqual(['book:1'])
    expect(filterAcademicHistory(events, 'Звёзды').map((event) => event.event_key)).toEqual(['star:1'])
  })

  it('объясняет составные статусы книги', () => {
    expect(historyStatusLabel(events[1])).toBe('Ждёт проверки')
    expect(historyStatusLabel({ category: 'book', status: 'finished:approved' })).toBe('Прочитано и подтверждено')
  })

  it('показывает точные границы учебного года без сдвига часового пояса', () => {
    expect(formatAcademicYear({ starts_on: '2026-09-01', ends_on: '2027-05-31' })).toBe('01.09.2026 — 31.05.2027')
  })

  it('выгружает понятный CSV с BOM, кавычками и русскими заголовками', () => {
    const csv = academicHistoryToCsv(events)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"Дата";"Раздел";"Название";"Описание";"Статус";"Звёзды"')
    expect(csv).toContain('"03.09.2026";"Домашка";"Русский язык"')
  })

  it('не позволяет пользовательскому тексту стать формулой таблицы', () => {
    const csv = academicHistoryToCsv([{ ...events[0], title: '=HYPERLINK("bad")', detail: ' +SUM(1;2)' }])
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"')
    expect(csv).toContain('"\' +SUM(1;2)"')
  })

  it('создаёт предсказуемое имя файла по выбранному году', () => {
    expect(academicHistoryFilename({ starts_on: '2026-09-01', ends_on: '2027-05-31' }))
      .toBe('shkolny-pomoshchnik-istoriya-2026-09-01-2027-05-31.csv')
  })
})
