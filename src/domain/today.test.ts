import { describe, expect, it } from 'vitest'
import { activeTodayClubs, activeTodayLessons, actionableTodayHomework, backpackProgress, formatFullRussianDate, type BackpackItem } from './today'

describe('экран ребёнка «Сегодня»', () => {
  it('не показывает отменённый урок как активный', () => {
    const lessons = [
      { weekday: 1, lesson_order: 1, starts_at: '08:00', ends_at: '08:40', subject_title: 'Русский язык', things: [], status: 'regular' as const },
      { weekday: 1, lesson_order: 2, starts_at: '09:00', ends_at: '09:40', subject_title: 'Чтение', things: [], status: 'cancelled' as const },
    ]
    expect(activeTodayLessons(lessons).map((lesson) => lesson.subject_title)).toEqual(['Русский язык'])
  })

  it('считает только домашку, которую ещё нужно выполнить', () => {
    const assignments = [
      { id: '1', subject_title: 'Математика', due_on: '2026-08-05', preferred_by: null, task: '№ 5', status: 'todo' as const },
      { id: '2', subject_title: 'Чтение', due_on: '2026-08-05', preferred_by: null, task: 'Страница 8', status: 'pending_review' as const },
      { id: '3', subject_title: 'Русский язык', due_on: '2026-08-06', preferred_by: null, task: 'Упражнение', status: 'needs_revision' as const },
    ]
    expect(actionableTodayHomework(assignments, '2026-08-05').map((item) => item.id)).toEqual(['1'])
  })

  it('исключает отменённый и исходный перенесённый кружок', () => {
    const base = { club_id: 'club', title: 'Робототехника', occurs_on: '2026-08-05', starts_at: '17:00', ends_at: '18:00', things: [], reminder_enabled: true, reminder_minutes: 30, replacement_day: null }
    expect(activeTodayClubs([
      { ...base, status: 'cancelled' },
      { ...base, status: 'rescheduled_from' },
      { ...base, status: 'rescheduled' },
    ]).map((item) => item.status)).toEqual(['rescheduled'])
  })

  it('считает прогресс рюкзака', () => {
    const items = [{ checked: true }, { checked: false }, { checked: true }] as BackpackItem[]
    expect(backpackProgress(items)).toEqual({ checked: 2, total: 3 })
  })

  it('показывает полную русскую дату', () => {
    expect(formatFullRussianDate('2026-08-05')).toContain('5 августа')
  })
})
