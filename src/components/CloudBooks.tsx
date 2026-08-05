import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { bookStatusLabel, filterBooks, validateReadingDiary, type BookFilter, type CloudBook, type ReadingDiaryDraft } from '../domain/books'
import { supabase } from '../lib/supabase'
import { loadWithOfflineFallback, offlineKey, saveOfflineSnapshot } from '../lib/offlineCache'
import { Icon } from './Icon'
import { useChildSession } from './ChildSession'
import { OfflineDataNote, useOnlineStatus } from './NetworkStatus'

const filters: BookFilter[] = ['Все', 'Читаю', 'Прочитано']

function draftFromBook(book: CloudBook): ReadingDiaryDraft {
  return { status: book.status === 'assigned' ? 'reading' : book.status, startedOn: book.started_on ?? '', finishedOn: book.finished_on ?? '', mainCharacters: book.main_characters, summary: book.summary, rating: book.rating }
}

function ReviewLabel({ book }: { book: CloudBook }) {
  if (book.review_status === 'approved') return <span className="book-review approved">Подтверждено родителем</span>
  if (book.review_status === 'pending_review') return <span className="book-review pending">Ждёт проверки</span>
  return null
}

export function CloudBooks() {
  const profile = useChildSession()
  const online = useOnlineStatus()
  const [books, setBooks] = useState<CloudBook[]>([])
  const [filter, setFilter] = useState<BookFilter>('Все')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [editingBook, setEditingBook] = useState<CloudBook | null>(null)
  const [draft, setDraft] = useState<ReadingDiaryDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [formError, setFormError] = useState('')
  const [cachedAt, setCachedAt] = useState<string | null>(null)

  async function loadBooks() {
    if (!supabase || !profile) return
    setState('loading')
    const result = await loadWithOfflineFallback<CloudBook[]>(offlineKey.books(profile.childId), () => supabase!.rpc('get_my_books'), online)
    if (result.source === 'none') setState('error')
    else { setBooks(result.data ?? []); setCachedAt(result.source === 'cache' ? result.savedAt : null); setState('ready') }
  }

  useEffect(() => { void loadBooks() }, [online, profile])

  const visibleBooks = useMemo(() => filterBooks(books, filter), [books, filter])
  const currentBook = filter === 'Все' ? books.find((book) => book.status === 'reading') : undefined
  const listBooks = currentBook ? visibleBooks.filter((book) => book.id !== currentBook.id) : visibleBooks

  function openDiary(book: CloudBook) {
    setEditingBook(book)
    setDraft(draftFromBook(book))
    setFormError('')
    setMessage('')
  }

  async function saveDiary(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !profile || !editingBook || !draft || saving) return
    if (!online) { setFormError('Подключись к интернету, чтобы сохранить дневник.'); return }
    const validationError = validateReadingDiary(draft)
    if (validationError) { setFormError(validationError); return }
    setSaving(true)
    setFormError('')
    const { data, error } = await supabase.rpc('update_my_reading_diary', {
      input_book_id: editingBook.id,
      input_status: draft.status,
      input_started_on: draft.startedOn || null,
      input_finished_on: draft.finishedOn || null,
      input_main_characters: draft.mainCharacters,
      input_summary: draft.summary,
      input_rating: draft.rating,
    })
    if (error) setFormError('Не получилось сохранить дневник. Проверь интернет и попробуй ещё раз.')
    else {
      const result = data?.[0] as { status: CloudBook['status']; review_status: CloudBook['review_status'] } | undefined
      const updated = books.map((book) => book.id === editingBook.id ? { ...book, status: result?.status ?? draft.status, review_status: result?.review_status ?? (draft.status === 'finished' ? 'pending_review' as const : 'not_submitted' as const), started_on: draft.startedOn || null, finished_on: draft.finishedOn || null, main_characters: draft.mainCharacters, summary: draft.summary, rating: draft.rating } : book)
      setBooks(updated)
      await saveOfflineSnapshot(offlineKey.books(profile.childId), updated)
      setMessage(draft.status === 'finished' ? 'Книга отправлена родителю на проверку.' : 'Дневник сохранён.')
      setEditingBook(null)
      setDraft(null)
    }
    setSaving(false)
  }

  function BookRow({ book }: { book: CloudBook }) {
    return <article className="card book-card cloud-book-card"><div className="book-mark small"><Icon name="books" /></div><div className="cloud-book-copy"><h2>{book.title}</h2><p>{book.author}</p><span className="book-status">{bookStatusLabel(book.status)}{book.rating ? ` · Оценка ${book.rating} из 5` : ''}</span><ReviewLabel book={book} /></div><button type="button" className="text-button" onClick={() => openDiary(book)}>{book.status === 'assigned' ? 'Начать' : 'Дневник'}</button></article>
  }

  return <section className="screen"><div className="screen-heading"><div><p className="eyebrow">Читательский дневник</p><h1>Книги</h1></div></div>
    <div className="filter-pills" aria-label="Показать книги">{filters.map((item) => <button type="button" key={item} className={filter === item ? 'selected' : ''} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}</div>
    {cachedAt && <OfflineDataNote savedAt={cachedAt} />}
    {message && <p className="auth-message success" role="status">{message}</p>}
    {state === 'loading' && <p className="child-cloud-state" role="status">Загружаем книги…</p>}
    {state === 'error' && <div className="auth-message error" role="alert"><p>{online ? 'Не получилось загрузить книги. Попробуй ещё раз.' : 'Сохранённых книг на этом устройстве пока нет.'}</p><button type="button" className="secondary-button" onClick={() => void loadBooks()}>Повторить</button></div>}
    {state === 'ready' && visibleBooks.length === 0 && <div className="child-cloud-state"><strong>Здесь пока нет книг</strong><p>{filter === 'Все' ? 'Родитель добавит книгу для чтения.' : 'Книги с таким статусом появятся здесь.'}</p></div>}
    {currentBook && <article className="current-book"><div className="book-mark"><Icon name="books" /></div><p className="eyebrow">Сейчас читаю</p><h2>{currentBook.title}</h2><p>{currentBook.author}</p><button type="button" className="primary-button" onClick={() => openDiary(currentBook)}>Открыть дневник</button></article>}
    {state === 'ready' && listBooks.length > 0 && <div className="book-list">{listBooks.map((book) => <BookRow book={book} key={book.id} />)}</div>}
    {editingBook && draft && <div className="sheet-backdrop"><section className="reading-diary-sheet" role="dialog" aria-modal="true" aria-labelledby="diary-title"><div className="sheet-heading"><div><p className="eyebrow">Читательский дневник</p><h2 id="diary-title">{editingBook.title}</h2></div><button type="button" className="sheet-close" aria-label="Закрыть дневник" onClick={() => { setEditingBook(null); setDraft(null) }}>×</button></div><p>{editingBook.author}</p><form className="auth-form" onSubmit={saveDiary}>
      <label htmlFor="book-status">Статус книги</label><select id="book-status" className="parent-select" value={draft.status} onChange={(event) => setDraft((current) => current ? { ...current, status: event.target.value as ReadingDiaryDraft['status'] } : current)} disabled={editingBook.review_status === 'approved'}><option value="assigned">Нужно прочитать</option><option value="reading">Читаю</option><option value="finished">Прочитано</option></select>
      <div className="parent-form-grid"><div><label htmlFor="book-started">Начал читать</label><input id="book-started" type="date" value={draft.startedOn} onChange={(event) => setDraft((current) => current ? { ...current, startedOn: event.target.value } : current)} /></div><div><label htmlFor="book-finished">Закончил читать</label><input id="book-finished" type="date" value={draft.finishedOn} onChange={(event) => setDraft((current) => current ? { ...current, finishedOn: event.target.value } : current)} /></div></div>
      <label htmlFor="book-characters">Главные герои</label><textarea id="book-characters" maxLength={2000} value={draft.mainCharacters} onChange={(event) => setDraft((current) => current ? { ...current, mainCharacters: event.target.value } : current)} placeholder="Кто был в этой истории?" />
      <label htmlFor="book-summary">Краткое содержание</label><textarea id="book-summary" maxLength={6000} value={draft.summary} onChange={(event) => setDraft((current) => current ? { ...current, summary: event.target.value } : current)} placeholder="О чём эта книга?" />
      <fieldset className="rating-field"><legend>Моя оценка</legend><div>{[1, 2, 3, 4, 5].map((rating) => <button type="button" key={rating} className={draft.rating === rating ? 'selected' : ''} aria-pressed={draft.rating === rating} aria-label={`Оценка ${rating} из 5`} onClick={() => setDraft((current) => current ? { ...current, rating } : current)}>{rating}</button>)}</div></fieldset>
      {formError && <p className="auth-message error" role="alert">{formError}</p>}<button type="submit" className="primary-button" disabled={saving || !online}>{saving ? 'Сохраняем…' : !online ? 'Нужен интернет' : draft.status === 'finished' ? 'Сохранить и отправить родителю' : 'Сохранить дневник'}</button>
    </form></section></div>}
  </section>
}
