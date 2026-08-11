import { describe, expect, it } from 'vitest'
import { applyReadingDiaryDraft, bookStatusLabel, filterBooks, readingDiaryCharacterPrompt, readingDiarySummaryPrompt, validateReadingDiary, type CloudBook } from './books'

const books: CloudBook[] = [
  { id: '1', title: 'Денискины рассказы', author: 'В. Драгунский', status: 'reading', started_on: '2026-08-01', finished_on: null, main_characters: '', summary: '', rating: null, review_status: 'not_submitted', updated_at: '2026-08-05T10:00:00.000Z' },
  { id: '2', title: 'Волшебник Изумрудного города', author: 'А. Волков', status: 'finished', started_on: '2026-07-01', finished_on: '2026-07-20', main_characters: 'Элли', summary: 'Путешествие', rating: 5, review_status: 'approved', updated_at: '2026-08-05T10:00:00.000Z' },
]

describe('читательский дневник', () => {
  it('фильтрует книги по детским вкладкам', () => {
    expect(filterBooks(books, 'Читаю').map((book) => book.id)).toEqual(['1'])
    expect(filterBooks(books, 'Прочитано').map((book) => book.id)).toEqual(['2'])
    expect(filterBooks(books, 'Все')).toHaveLength(2)
  })

  it('не разрешает дату окончания раньше даты начала', () => {
    expect(validateReadingDiary({ status: 'finished', startedOn: '2026-08-05', finishedOn: '2026-08-04', mainCharacters: '', summary: '', rating: 5 })).toBe('Дата окончания не может быть раньше даты начала.')
  })

  it('требует дату окончания для прочитанной книги', () => {
    expect(validateReadingDiary({ status: 'finished', startedOn: '2026-08-01', finishedOn: '', mainCharacters: '', summary: '', rating: 5 })).toBe('Укажи дату, когда закончил читать.')
  })

  it('принимает только целую оценку от одного до пяти', () => {
    expect(validateReadingDiary({ status: 'reading', startedOn: '', finishedOn: '', mainCharacters: '', summary: '', rating: 6 })).toBe('Выбери оценку от 1 до 5.')
    expect(validateReadingDiary({ status: 'reading', startedOn: '', finishedOn: '', mainCharacters: '', summary: '', rating: 4 })).toBeNull()
  })

  it('возвращает понятные русские статусы', () => {
    expect(bookStatusLabel('assigned')).toBe('Нужно прочитать')
    expect(bookStatusLabel('reading')).toBe('Читаю')
    expect(bookStatusLabel('finished')).toBe('Прочитано')
  })

  it('показывает локально сохранённый дневник до синхронизации', () => {
    const updated = applyReadingDiaryDraft(books[0], { status: 'finished', startedOn: '2026-08-01', finishedOn: '2026-08-06', mainCharacters: 'Дениска', summary: 'Несколько рассказов', rating: 5 })
    expect(updated).toMatchObject({ status: 'finished', review_status: 'pending_review', finished_on: '2026-08-06', rating: 5 })
    expect(updated.updated_at).toBe(books[0].updated_at)
  })

  it('не снимает родительское подтверждение при правке текста', () => {
    const updated = applyReadingDiaryDraft(books[1], { status: 'reading', startedOn: '2026-07-01', finishedOn: '2026-07-20', mainCharacters: 'Элли и Тотошка', summary: 'Уточнённое содержание', rating: 4 })
    expect(updated).toMatchObject({ status: 'finished', review_status: 'approved', rating: 4 })
  })

  it('стабильно выбирает один вопрос о героях для каждой книги', () => {
    const firstPrompt = readingDiaryCharacterPrompt(books[0])
    expect(readingDiaryCharacterPrompt(books[0])).toBe(firstPrompt)
    expect(firstPrompt.length).toBeGreaterThan(20)
  })

  it('чередует вопросы о героях между разными книгами', () => {
    const prompts = Array.from({ length: 12 }, (_, index) => readingDiaryCharacterPrompt({ id: String(index), title: `Сказка ${index}` }))
    expect(new Set(prompts).size).toBeGreaterThan(1)
  })

  it('просит пересказать книгу тремя предложениями', () => {
    expect(readingDiarySummaryPrompt).toBe('О чём эта книга? Составь три предложения.')
  })
})
