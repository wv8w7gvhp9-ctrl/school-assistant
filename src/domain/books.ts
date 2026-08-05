export type BookStatus = 'assigned' | 'reading' | 'finished'
export type BookReviewStatus = 'not_submitted' | 'pending_review' | 'approved'
export type BookFilter = 'Все' | 'Читаю' | 'Прочитано'

export type CloudBook = {
  id: string
  title: string
  author: string
  status: BookStatus
  started_on: string | null
  finished_on: string | null
  main_characters: string
  summary: string
  rating: number | null
  review_status: BookReviewStatus
}

export type ReadingDiaryDraft = {
  status: BookStatus
  startedOn: string
  finishedOn: string
  mainCharacters: string
  summary: string
  rating: number | null
}

export function filterBooks(books: CloudBook[], filter: BookFilter) {
  if (filter === 'Читаю') return books.filter((book) => book.status === 'reading')
  if (filter === 'Прочитано') return books.filter((book) => book.status === 'finished')
  return books
}

export function validateReadingDiary(draft: ReadingDiaryDraft) {
  if (draft.startedOn && draft.finishedOn && draft.finishedOn < draft.startedOn) return 'Дата окончания не может быть раньше даты начала.'
  if (draft.rating !== null && (!Number.isInteger(draft.rating) || draft.rating < 1 || draft.rating > 5)) return 'Выбери оценку от 1 до 5.'
  if (draft.status === 'finished' && !draft.finishedOn) return 'Укажи дату, когда закончил читать.'
  return null
}

export function bookStatusLabel(status: BookStatus) {
  if (status === 'reading') return 'Читаю'
  if (status === 'finished') return 'Прочитано'
  return 'Нужно прочитать'
}
