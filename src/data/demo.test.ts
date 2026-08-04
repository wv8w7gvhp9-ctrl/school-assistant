import { describe, expect, it } from 'vitest'
import { books, clubs, homework, todayLessons } from './demo'

describe('демонстрационные данные ребёнка', () => {
  it('показывают только поддерживаемые статусы домашней работы', () => {
    expect(homework.map((item) => item.status)).toEqual([
      'todo',
      'needs_revision',
      'pending_review',
      'approved',
    ])
  })

  it('содержат вещи для каждого урока и кружка', () => {
    expect(todayLessons.every((lesson) => lesson.things.length > 0)).toBe(true)
    expect(clubs.every((club) => club.things.length > 0)).toBe(true)
  })

  it('показывают книгу для чтения и прочитанную книгу с оценкой', () => {
    expect(books.some((book) => book.status === 'Читаю')).toBe(true)
    expect(books.find((book) => book.status === 'Прочитано')?.rating).toBe(5)
  })
})
