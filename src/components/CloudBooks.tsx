import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { applyReadingDiaryDraft, bookStatusLabel, filterBooks, validateReadingDiary, type BookFilter, type CloudBook, type ReadingDiaryDraft, type StoredReadingDiaryDraft } from '../domain/books'
import { deleteOfflineRecord, loadWithOfflineFallback, offlineKey, readOfflineRecord, saveOfflineSnapshot, writeOfflineRecord } from '../lib/offlineCache'
import { enqueueReadingDiary, listReadingDiaryMutations, notifyOfflineQueueChanged, offlineQueueSyncedEvent, type OfflineSyncResult, type ReadingDiaryMutation } from '../lib/offlineQueue'
import { supabase } from '../lib/supabase'
import { useChildSession } from './ChildSession'
import { Icon } from './Icon'
import { OfflineDataNote, useOnlineStatus } from './NetworkStatus'

const filters: BookFilter[] = ['Все', 'Читаю', 'Прочитано']
type BooksMessage = { kind: 'success' | 'warning' | 'error'; text: string } | null

function draftFromBook(book: CloudBook): ReadingDiaryDraft {
  return { status: book.status === 'assigned' ? 'reading' : book.status, startedOn: book.started_on ?? '', finishedOn: book.finished_on ?? '', mainCharacters: book.main_characters, summary: book.summary, rating: book.rating }
}

function ReviewLabel({ book, queued }: { book: CloudBook; queued: boolean }) {
  if (queued) return <span className="book-review pending-sync">Ждёт отправки</span>
  if (book.review_status === 'approved') return <span className="book-review approved">Подтверждено родителем</span>
  if (book.review_status === 'pending_review') return <span className="book-review pending">Ждёт проверки</span>
  return null
}

export function CloudBooks() {
  const profile = useChildSession()
  const online = useOnlineStatus()
  const openingBookId = useRef<string | null>(null)
  const draftRevision = useRef(0)
  const [books, setBooks] = useState<CloudBook[]>([])
  const [filter, setFilter] = useState<BookFilter>('Все')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [editingBook, setEditingBook] = useState<CloudBook | null>(null)
  const [draft, setDraft] = useState<ReadingDiaryDraft | null>(null)
  const [draftDirty, setDraftDirty] = useState(false)
  const [draftNotice, setDraftNotice] = useState<BooksMessage>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<BooksMessage>(null)
  const [formError, setFormError] = useState('')
  const [cachedAt, setCachedAt] = useState<string | null>(null)
  const [queuedBookIds, setQueuedBookIds] = useState<Set<string>>(new Set())

  async function readReadingQueue() {
    if (!profile) return []
    try {
      return await listReadingDiaryMutations(profile.childId)
    } catch (error) {
      console.error('Не удалось прочитать очередь читательского дневника', error)
      return []
    }
  }

  function overlayPendingBooks(source: CloudBook[], mutations: ReadingDiaryMutation[]) {
    const pendingByBook = new Map(mutations.map((mutation) => [mutation.bookId, mutation.draft]))
    return source.map((book) => {
      const pendingDraft = pendingByBook.get(book.id)
      return pendingDraft ? applyReadingDiaryDraft(book, pendingDraft) : book
    })
  }

  async function refreshReadingQueue() {
    const mutations = await readReadingQueue()
    setQueuedBookIds(new Set(mutations.map((mutation) => mutation.bookId)))
    return mutations
  }

  async function loadBooks() {
    if (!supabase || !profile) return
    setState('loading')
    const [result, mutations] = await Promise.all([
      loadWithOfflineFallback<CloudBook[]>(offlineKey.books(profile.childId), () => supabase!.rpc('get_my_books_v2'), online),
      readReadingQueue(),
    ])
    if (result.source === 'none') {
      setState('error')
      return
    }
    setBooks(overlayPendingBooks(result.data ?? [], mutations))
    setQueuedBookIds(new Set(mutations.map((mutation) => mutation.bookId)))
    setCachedAt(result.source === 'cache' ? result.savedAt : null)
    setState('ready')
  }

  useEffect(() => { void loadBooks() }, [online, profile])

  useEffect(() => {
    if (!profile) return
    const handleSync = (event: Event) => {
      const detail = (event as CustomEvent<{ childId: string; results: OfflineSyncResult[] }>).detail
      if (!detail || detail.childId !== profile.childId) return
      const diaryResults = detail.results.filter((result) => result.mutation.kind === 'save_reading_diary')
      if (diaryResults.length === 0) return
      void refreshReadingQueue()
      if (diaryResults.some((result) => result.outcome === 'conflict')) {
        setMessage({ kind: 'warning', text: 'Дневник изменился на другом устройстве. Твой черновик сохранён — открой книгу и проверь его.' })
      } else if (diaryResults.some((result) => result.outcome === 'missing')) {
        setMessage({ kind: 'warning', text: 'Книга больше недоступна. Черновик остался сохранён на этом устройстве.' })
      } else if (diaryResults.some((result) => result.outcome === 'retry')) {
        setMessage({ kind: 'warning', text: 'Дневник сохранён на устройстве. Отправим автоматически.' })
      } else {
        setMessage({ kind: 'success', text: 'Дневник отправлен и сохранён.' })
      }
      if (online && diaryResults.some((result) => result.outcome !== 'retry')) void loadBooks()
    }
    void refreshReadingQueue()
    window.addEventListener(offlineQueueSyncedEvent, handleSync)
    return () => window.removeEventListener(offlineQueueSyncedEvent, handleSync)
  }, [online, profile])

  useEffect(() => {
    if (!profile || !editingBook || !draft || !draftDirty) return
    const bookId = editingBook.id
    const revision = draftRevision.current
    const timer = window.setTimeout(() => {
      const stored: StoredReadingDiaryDraft = { bookId, expectedUpdatedAt: editingBook.updated_at, draft }
      void writeOfflineRecord(offlineKey.readingDiaryDraft(profile.childId, bookId), stored)
        .then(() => {
          if (openingBookId.current === bookId && draftRevision.current === revision) {
            setDraftDirty(false)
            setDraftNotice({ kind: 'success', text: 'Черновик сохранён на устройстве.' })
          }
        })
        .catch((error) => {
          console.error('Не удалось автоматически сохранить черновик дневника', error)
          if (openingBookId.current === bookId && draftRevision.current === revision) setDraftNotice({ kind: 'error', text: 'Не получилось сохранить черновик на устройстве.' })
        })
    }, 500)
    return () => window.clearTimeout(timer)
  }, [draft, draftDirty, editingBook, profile])

  const visibleBooks = useMemo(() => filterBooks(books, filter), [books, filter])
  const currentBook = filter === 'Все' ? books.find((book) => book.status === 'reading') : undefined
  const listBooks = currentBook ? visibleBooks.filter((book) => book.id !== currentBook.id) : visibleBooks

  async function openDiary(book: CloudBook) {
    openingBookId.current = book.id
    draftRevision.current = 0
    setEditingBook(book)
    setDraft(draftFromBook(book))
    setDraftDirty(false)
    setDraftNotice(null)
    setConfirmDiscard(false)
    setFormError('')
    setMessage(null)
    if (!profile) return
    try {
      const stored = await readOfflineRecord<StoredReadingDiaryDraft>(offlineKey.readingDiaryDraft(profile.childId, book.id))
      if (openingBookId.current !== book.id || draftRevision.current !== 0 || !stored || stored.data.bookId !== book.id) return
      setDraft(stored.data.draft)
      setDraftDirty(false)
      setDraftNotice({ kind: 'warning', text: stored.data.expectedUpdatedAt === book.updated_at ? 'Открыт сохранённый черновик.' : 'Открыт черновик из более ранней версии книги. Перед отправкой проверь изменения.' })
    } catch (error) {
      console.error('Не удалось открыть локальный черновик дневника', error)
      if (openingBookId.current === book.id) setDraftNotice({ kind: 'error', text: 'Не получилось открыть сохранённый черновик.' })
    }
  }

  function updateDraft(change: Partial<ReadingDiaryDraft>) {
    draftRevision.current += 1
    setDraft((current) => current ? { ...current, ...change } : current)
    setDraftDirty(true)
    setDraftNotice({ kind: 'warning', text: 'Сохраняем черновик…' })
  }

  async function closeDiary() {
    if (!profile || !editingBook || !draft || !draftDirty) {
      openingBookId.current = null
      draftRevision.current = 0
      setEditingBook(null)
      setDraft(null)
      return
    }
    try {
      await writeOfflineRecord(offlineKey.readingDiaryDraft(profile.childId, editingBook.id), { bookId: editingBook.id, expectedUpdatedAt: editingBook.updated_at, draft } satisfies StoredReadingDiaryDraft)
      openingBookId.current = null
      draftRevision.current = 0
      setEditingBook(null)
      setDraft(null)
      setDraftDirty(false)
    } catch (error) {
      console.error('Не удалось сохранить черновик перед закрытием', error)
      setFormError('Не получилось сохранить черновик. Не закрывай дневник и попробуй ещё раз.')
    }
  }

  async function saveDiary(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile || !editingBook || !draft || saving) return
    const validationError = validateReadingDiary(draft)
    if (validationError) { setFormError(validationError); return }
    if (!editingBook.updated_at) { setFormError('Сначала открой книгу с интернетом, затем попробуй ещё раз.'); return }
    setSaving(true)
    setFormError('')
    try {
      const draftKey = offlineKey.readingDiaryDraft(profile.childId, editingBook.id)
      await writeOfflineRecord(draftKey, { bookId: editingBook.id, expectedUpdatedAt: editingBook.updated_at, draft } satisfies StoredReadingDiaryDraft)
      await enqueueReadingDiary(profile.childId, editingBook.id, editingBook.updated_at, draft)
      const updated = books.map((book) => book.id === editingBook.id ? applyReadingDiaryDraft(book, draft) : book)
      setBooks(updated)
      setQueuedBookIds((current) => new Set(current).add(editingBook.id))
      await saveOfflineSnapshot(offlineKey.books(profile.childId), updated)
      setMessage(online
        ? { kind: 'warning', text: 'Дневник сохранён. Отправляем…' }
        : { kind: 'warning', text: 'Дневник сохранён на устройстве. Отправим, когда появится интернет.' })
      openingBookId.current = null
      draftRevision.current = 0
      setEditingBook(null)
      setDraft(null)
      setDraftDirty(false)
      notifyOfflineQueueChanged()
    } catch (error) {
      console.error('Не удалось сохранить дневник в локальную очередь', error)
      setFormError('Не получилось сохранить дневник на устройстве. Попробуй ещё раз.')
    }
    setSaving(false)
  }

  async function discardDraft() {
    if (!profile || !editingBook) return
    try {
      await deleteOfflineRecord(offlineKey.readingDiaryDraft(profile.childId, editingBook.id))
      setDraft(draftFromBook(editingBook))
      draftRevision.current = 0
      setDraftDirty(false)
      setDraftNotice({ kind: 'success', text: 'Черновик удалён. Показаны последние сохранённые данные.' })
      setConfirmDiscard(false)
      setFormError('')
    } catch (error) {
      console.error('Не удалось удалить черновик дневника', error)
      setFormError('Не получилось удалить черновик с устройства.')
    }
  }

  function BookRow({ book }: { book: CloudBook }) {
    const queued = queuedBookIds.has(book.id)
    return <article className={`card book-card cloud-book-card ${queued ? 'pending-sync' : ''}`}><div className="book-mark small"><Icon name="books" /></div><div className="cloud-book-copy"><h2>{book.title}</h2><p>{book.author}</p><span className="book-status">{bookStatusLabel(book.status)}{book.rating ? ` · Оценка ${book.rating} из 5` : ''}</span><ReviewLabel book={book} queued={queued} /></div><button type="button" className="text-button" onClick={() => void openDiary(book)}>{queued ? 'Черновик' : book.status === 'assigned' ? 'Начать' : 'Дневник'}</button></article>
  }

  return <section className="screen"><div className="screen-heading"><div><p className="eyebrow">Читательский дневник</p><h1>Книги</h1></div></div>
    <div className="filter-pills" aria-label="Показать книги">{filters.map((item) => <button type="button" key={item} className={filter === item ? 'selected' : ''} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}</div>
    {cachedAt && <OfflineDataNote savedAt={cachedAt} />}
    {message && <p className={`auth-message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
    {state === 'loading' && <p className="child-cloud-state" role="status">Загружаем книги…</p>}
    {state === 'error' && <div className="auth-message error" role="alert"><p>{online ? 'Не получилось загрузить книги. Попробуй ещё раз.' : 'Сохранённых книг на этом устройстве пока нет.'}</p><button type="button" className="secondary-button" onClick={() => void loadBooks()}>Повторить</button></div>}
    {state === 'ready' && visibleBooks.length === 0 && <div className="child-cloud-state"><strong>Здесь пока нет книг</strong><p>{filter === 'Все' ? 'Родитель добавит книгу для чтения.' : 'Книги с таким статусом появятся здесь.'}</p></div>}
    {currentBook && <article className={`current-book ${queuedBookIds.has(currentBook.id) ? 'pending-sync' : ''}`}><div className="book-mark"><Icon name="books" /></div><p className="eyebrow">Сейчас читаю</p><h2>{currentBook.title}</h2><p>{currentBook.author}</p><ReviewLabel book={currentBook} queued={queuedBookIds.has(currentBook.id)} /><button type="button" className="primary-button" onClick={() => void openDiary(currentBook)}>Открыть дневник</button></article>}
    {state === 'ready' && listBooks.length > 0 && <div className="book-list">{listBooks.map((book) => <BookRow book={book} key={book.id} />)}</div>}
    {editingBook && draft && <div className="sheet-backdrop"><section className="reading-diary-sheet" role="dialog" aria-modal="true" aria-labelledby="diary-title"><div className="sheet-heading"><div><p className="eyebrow">Читательский дневник</p><h2 id="diary-title">{editingBook.title}</h2></div><button type="button" className="sheet-close" aria-label="Закрыть дневник" onClick={() => void closeDiary()}>×</button></div><p>{editingBook.author}</p><form className="auth-form" onSubmit={saveDiary}>
      <label htmlFor="book-status">Статус книги</label><select id="book-status" className="parent-select" value={draft.status} onChange={(event) => updateDraft({ status: event.target.value as ReadingDiaryDraft['status'] })} disabled={editingBook.review_status === 'approved'}><option value="assigned">Нужно прочитать</option><option value="reading">Читаю</option><option value="finished">Прочитано</option></select>
      <div className="parent-form-grid"><div><label htmlFor="book-started">Начал читать</label><input id="book-started" type="date" value={draft.startedOn} onChange={(event) => updateDraft({ startedOn: event.target.value })} /></div><div><label htmlFor="book-finished">Закончил читать</label><input id="book-finished" type="date" value={draft.finishedOn} onChange={(event) => updateDraft({ finishedOn: event.target.value })} /></div></div>
      <label htmlFor="book-characters">Главные герои</label><textarea id="book-characters" maxLength={2000} value={draft.mainCharacters} onChange={(event) => updateDraft({ mainCharacters: event.target.value })} placeholder="Кто был в этой истории?" />
      <label htmlFor="book-summary">Краткое содержание</label><textarea id="book-summary" maxLength={6000} value={draft.summary} onChange={(event) => updateDraft({ summary: event.target.value })} placeholder="О чём эта книга?" />
      <fieldset className="rating-field"><legend>Моя оценка</legend><div>{[1, 2, 3, 4, 5].map((rating) => <button type="button" key={rating} className={draft.rating === rating ? 'selected' : ''} aria-pressed={draft.rating === rating} aria-label={`Оценка ${rating} из 5`} onClick={() => updateDraft({ rating })}>{rating}</button>)}</div></fieldset>
      {draftNotice && <p className={`diary-draft-note ${draftNotice.kind}`} role={draftNotice.kind === 'error' ? 'alert' : 'status'}>{draftNotice.text}</p>}
      {formError && <p className="auth-message error" role="alert">{formError}</p>}
      <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Сохраняем…' : online ? draft.status === 'finished' ? 'Сохранить и отправить родителю' : 'Сохранить дневник' : 'Сохранить на устройстве'}</button>
      {draftNotice && !queuedBookIds.has(editingBook.id) && !confirmDiscard && <button type="button" className="secondary-button" disabled={saving} onClick={() => setConfirmDiscard(true)}>Отказаться от черновика</button>}
      {confirmDiscard && <div className="parent-confirm"><p>Удалить только черновик с этого устройства? Уже отправленные родителю данные не изменятся.</p><div><button type="button" className="secondary-button" onClick={() => setConfirmDiscard(false)}>Оставить</button><button type="button" className="danger-button" disabled={saving} onClick={() => void discardDraft()}>Удалить черновик</button></div></div>}
    </form></section></div>}
  </section>
}
