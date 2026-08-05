import { describe, expect, it } from 'vitest'
import { bookStatusLabel, filterBooks, validateReadingDiary, type CloudBook } from './books'

const books: CloudBook[] = [
  { id: '1', title: 'Денискины рассказы', author: 'В. Драгунский', status: 'reading', started_on: '2026-08-01', finished_on: null, main_characters: '', summary: '', rating: null, review_status: 'not_submitted' },
  { id: '2', title: 'Волшебник Изумрудного города', author: 'А. Волков', status: 'finished', started_on: '2026-07-01', finished_on: '2026-07-20', main_characters: 'Элли', summary: 'Путешествие', rating: 5, review_status: 'approved' },
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
})
