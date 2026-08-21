import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CloudBook } from '../domain/books'
import { groupBackpackReviews, isMissingParentBookReviewsRpc, reviewAwardMessage, reviewCountLabel, reviewQueueRefreshIntervalMs, type BackpackReviewRow } from '../domain/reviews'
import { homeworkApprovalMessage } from '../domain/stars'
import { formatFullRussianDate } from '../domain/today'
import { offlineKey, readOfflineSnapshot, saveOfflineSnapshot } from '../lib/offlineCache'
import { supabase } from '../lib/supabase'
import { OfflineDataNote, useOnlineStatus } from './NetworkStatus'
import { StatusChip } from './UI'

type HomeworkReview = {
  id: string
  due_on: string
  preferred_by: string | null
  task: string
  status: 'pending_review'
  updated_at: string
  subject_title: string
}

type ReviewQueueProps = {
  parentUserId: string
  familyId: string
  childId: string
  childName: string
  onReviewed: () => void
}

type ReviewSection = 'homework' | 'books' | 'backpack'

type ParentReviewQueueSnapshot = {
  homework: HomeworkReview[]
  books: CloudBook[]
  backpackRows: BackpackReviewRow[]
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Samara' }).format(new Date(`${value}T12:00:00+04:00`))
}

export function ParentReviewQueue({ parentUserId, familyId, childId, childName, onReviewed }: ReviewQueueProps) {
  const online = useOnlineStatus()
  const cacheKey = offlineKey.parentReviewQueue(parentUserId, familyId)
  const [homework, setHomework] = useState<HomeworkReview[]>([])
  const [books, setBooks] = useState<CloudBook[]>([])
  const [backpackRows, setBackpackRows] = useState<BackpackReviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [queueAvailable, setQueueAvailable] = useState(false)
  const [cachedAt, setCachedAt] = useState<string | null>(null)
  const [failedSections, setFailedSections] = useState<string[]>([])
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const requestIdRef = useRef(0)

  const restoreQueueSnapshot = useCallback(async (requestId: number, sections?: Set<ReviewSection>) => {
    const cached = await readOfflineSnapshot<ParentReviewQueueSnapshot>(cacheKey)
    if (requestId !== requestIdRef.current || !cached) return false
    if (!sections || sections.has('homework')) setHomework(cached.data.homework)
    if (!sections || sections.has('books')) setBooks(cached.data.books)
    if (!sections || sections.has('backpack')) setBackpackRows(cached.data.backpackRows)
    setQueueAvailable(true)
    setCachedAt(cached.savedAt)
    return true
  }, [cacheKey])

  const loadQueue = useCallback(async () => {
    if (!supabase) return
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    if (!online) {
      setFailedSections([])
      const restored = await restoreQueueSnapshot(requestId)
      if (requestId === requestIdRef.current) {
        if (!restored) setQueueAvailable(false)
        setHasLoaded(true)
        setLoading(false)
      }
      return
    }
    setFailedSections([])
    try {
      const [homeworkResult, protectedBooksResult, backpackResult] = await Promise.all([
        supabase.rpc('get_parent_homework_reviews'),
        supabase.rpc('get_parent_book_reviews'),
        supabase.rpc('get_parent_backpack_reviews'),
      ])
      if (requestId !== requestIdRef.current) return
      const booksResult = protectedBooksResult.error && isMissingParentBookReviewsRpc(protectedBooksResult.error)
        ? await supabase.from('books').select('id, title, author, status, started_on, finished_on, main_characters, summary, rating, review_status, updated_at').eq('family_id', familyId).eq('child_id', childId).eq('status', 'finished').eq('review_status', 'pending_review').order('updated_at')
        : protectedBooksResult
      if (requestId !== requestIdRef.current) return
      const failed: string[] = []
      const failedKeys = new Set<ReviewSection>()
      const freshHomework = (homeworkResult.data ?? []) as unknown as HomeworkReview[]
      const freshBooks = (booksResult.data ?? []) as CloudBook[]
      const freshBackpackRows = (backpackResult.data ?? []) as unknown as BackpackReviewRow[]
      if (homeworkResult.error) {
        console.error('Не удалось загрузить домашку на проверку', homeworkResult.error)
        failed.push('домашку')
        failedKeys.add('homework')
      }
      else setHomework(freshHomework)
      if (booksResult.error) {
        console.error('Не удалось загрузить книги на проверку', booksResult.error)
        failed.push('книги')
        failedKeys.add('books')
      }
      else setBooks(freshBooks)
      if (backpackResult.error) {
        console.error('Не удалось загрузить рюкзак на проверку', backpackResult.error)
        failed.push('рюкзак')
        failedKeys.add('backpack')
      }
      else setBackpackRows(freshBackpackRows)
      if (failedKeys.size === 0) {
        setQueueAvailable(true)
        setCachedAt(null)
        await saveOfflineSnapshot(cacheKey, { homework: freshHomework, books: freshBooks, backpackRows: freshBackpackRows } satisfies ParentReviewQueueSnapshot)
      }
      else {
        const restored = await restoreQueueSnapshot(requestId, failedKeys)
        if (!restored && failedKeys.size < 3) setQueueAvailable(true)
      }
      setFailedSections(failed)
    }
    catch (error) {
      if (requestId !== requestIdRef.current) return
      console.error('Не удалось обновить очередь проверки', error)
      const restored = await restoreQueueSnapshot(requestId)
      if (!restored) setQueueAvailable(false)
      setFailedSections(['домашку', 'книги', 'рюкзак'])
    }
    finally {
      if (requestId === requestIdRef.current) {
        setHasLoaded(true)
        setLoading(false)
      }
    }
  }, [familyId, childId, online, cacheKey, restoreQueueSnapshot])

  useEffect(() => { void loadQueue() }, [loadQueue])

  useEffect(() => {
    if (!online) return
    const refreshVisibleQueue = () => {
      if (document.visibilityState === 'visible') void loadQueue()
    }
    window.addEventListener('focus', refreshVisibleQueue)
    document.addEventListener('visibilitychange', refreshVisibleQueue)
    return () => {
      window.removeEventListener('focus', refreshVisibleQueue)
      document.removeEventListener('visibilitychange', refreshVisibleQueue)
    }
  }, [loadQueue, online])

  useEffect(() => {
    if (!online) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadQueue()
    }, reviewQueueRefreshIntervalMs)
    return () => window.clearInterval(timer)
  }, [loadQueue, online])

  const backpacks = useMemo(() => groupBackpackReviews(backpackRows), [backpackRows])
  const counts = { homework: homework.length, book: books.length, backpack: backpacks.length }
  const total = counts.homework + counts.book + counts.backpack

  async function reviewHomework(id: string, decision: 'approved' | 'needs_revision') {
    if (!supabase || busyKey || !online) return
    setBusyKey(`homework:${id}`); setActionError(''); setMessage('')
    try {
      const { data, error } = await supabase.rpc('review_homework', { input_homework_id: id, input_decision: decision })
      if (error) throw error
      const nextHomework = homework.filter((item) => item.id !== id)
      setHomework(nextHomework)
      await saveOfflineSnapshot(cacheKey, { homework: nextHomework, books, backpackRows } satisfies ParentReviewQueueSnapshot)
      const stars = Number((data?.[0] as { stars_awarded?: number } | undefined)?.stars_awarded ?? 0)
      setMessage(decision === 'approved' ? homeworkApprovalMessage(stars) : 'Задание возвращено на доработку.')
      onReviewed()
    }
    catch (error) {
      console.error('Не удалось сохранить решение по домашке', error)
      setActionError('Не удалось сохранить решение по домашке. Попробуйте ещё раз.')
    }
    finally { setBusyKey(null) }
  }

  async function reviewBook(id: string) {
    if (!supabase || busyKey || !online) return
    setBusyKey(`book:${id}`); setActionError(''); setMessage('')
    try {
      const { data, error } = await supabase.rpc('review_finished_book', { input_book_id: id })
      if (error) throw error
      const stars = Number((data?.[0] as { stars_awarded?: number } | undefined)?.stars_awarded ?? 0)
      const nextBooks = books.filter((book) => book.id !== id)
      setBooks(nextBooks)
      await saveOfflineSnapshot(cacheKey, { homework, books: nextBooks, backpackRows } satisfies ParentReviewQueueSnapshot)
      setMessage(reviewAwardMessage('book', stars))
      onReviewed()
    }
    catch (error) {
      console.error('Не удалось подтвердить книгу', error)
      setActionError('Не удалось подтвердить книгу. Попробуйте ещё раз.')
    }
    finally { setBusyKey(null) }
  }

  async function reviewBackpack(id: string) {
    if (!supabase || busyKey || !online) return
    setBusyKey(`backpack:${id}`); setActionError(''); setMessage('')
    try {
      const { data, error } = await supabase.rpc('review_backpack', { input_checklist_id: id })
      if (error) throw error
      const stars = Number((data?.[0] as { stars_awarded?: number } | undefined)?.stars_awarded ?? 0)
      const nextBackpackRows = backpackRows.filter((row) => row.checklist_id !== id)
      setBackpackRows(nextBackpackRows)
      await saveOfflineSnapshot(cacheKey, { homework, books, backpackRows: nextBackpackRows } satisfies ParentReviewQueueSnapshot)
      setMessage(reviewAwardMessage('backpack', stars))
      onReviewed()
    }
    catch (error) {
      console.error('Не удалось подтвердить рюкзак', error)
      setActionError('Не удалось подтвердить рюкзак. Попробуйте ещё раз.')
    }
    finally { setBusyKey(null) }
  }

  return <section className="parent-review-queue" aria-labelledby="parent-review-title">
    <div className="parent-section-heading"><div><p className="eyebrow">Для родителя</p><h2 id="parent-review-title">Проверка</h2></div><span className="review-count" aria-label={reviewCountLabel(total)}>{total}</span></div>
    <p>Все работы ребёнка, которые ждут вашего решения, собраны здесь.</p>
    <div className="review-summary" aria-label={`Ожидают проверки: домашка ${counts.homework}, книги ${counts.book}, рюкзак ${counts.backpack}`}><span>Домашка <strong>{counts.homework}</strong></span><span>Книги <strong>{counts.book}</strong></span><span>Рюкзак <strong>{counts.backpack}</strong></span></div>
    <button type="button" className="text-button review-refresh" disabled={!online || loading} onClick={() => void loadQueue()}>{loading && hasLoaded ? 'Обновляем очередь…' : 'Обновить очередь'}</button>
    {!online && <div className="auth-message warning" role="status"><strong>Нет интернета</strong><p>{queueAvailable ? 'Показываем последние сохранённые карточки. Подтверждение и возврат станут доступны после подключения.' : 'Подключитесь, чтобы впервые загрузить очередь проверки.'}</p></div>}
    {cachedAt && <OfflineDataNote savedAt={cachedAt} />}
    {loading && !hasLoaded && <p className="auth-loading" role="status">Собираем очередь проверки…</p>}
    {failedSections.length > 0 && <div className="auth-message error" role="alert"><p>Не удалось обновить: {failedSections.join(', ')}. Ранее загруженные карточки сохранены.</p><button type="button" className="secondary-button" disabled={!online || loading} onClick={() => void loadQueue()}>Повторить</button></div>}
    {actionError && <div className="auth-message error" role="alert"><p>{actionError}</p><button type="button" className="secondary-button" disabled={!online || loading} onClick={() => { setActionError(''); void loadQueue() }}>Обновить очередь</button></div>}
    {message && <p className="auth-message success" role="status">{message}</p>}
    {!loading && hasLoaded && queueAvailable && total === 0 && failedSections.length === 0 && <div className="parent-empty review-empty"><strong>Всё проверено</strong><p>Новых работ от {childName} пока нет.</p></div>}
    <div className="review-list">
      {homework.map((item) => <article className="review-card" key={`homework:${item.id}`}><div className="review-card-heading"><span className="review-kind">Домашка</span><StatusChip status="pending_review" /></div><h3>{item.subject_title || 'Предмет'}</h3><p>{item.task}</p><small>К {formatDate(item.due_on)}{item.preferred_by ? ` · желательно до ${item.preferred_by.slice(0, 5)}` : ''}</small><div className="parent-review-actions"><button type="button" className="success-button" disabled={Boolean(busyKey) || !online} onClick={() => void reviewHomework(item.id, 'approved')}>{busyKey === `homework:${item.id}` ? 'Сохраняем…' : 'Подтвердить'}</button><button type="button" className="secondary-button" disabled={Boolean(busyKey) || !online} onClick={() => void reviewHomework(item.id, 'needs_revision')}>Вернуть на доработку</button></div></article>)}
      {books.map((book) => <article className="review-card" key={`book:${book.id}`}><div className="review-card-heading"><span className="review-kind">Книга</span><StatusChip status="pending_review" /></div><h3>{book.title}</h3><p>{book.author}</p>{book.main_characters && <p><strong>Ответ о героях:</strong> {book.main_characters}</p>}{book.summary && <p><strong>О книге:</strong> {book.summary}</p>}{book.rating && <p><strong>Оценка:</strong> {book.rating} из 5</p>}<button type="button" className="success-button" disabled={Boolean(busyKey) || !online} onClick={() => void reviewBook(book.id)}>{busyKey === `book:${book.id}` ? 'Подтверждаем…' : 'Подтвердить прочтение'}</button></article>)}
      {backpacks.map((backpack) => <article className="review-card" key={`backpack:${backpack.checklistId}`}><div className="review-card-heading"><span className="review-kind">Рюкзак</span><StatusChip status="pending_review" /></div><h3>Рюкзак собран</h3><p>На {formatFullRussianDate(backpack.targetDay).toLowerCase()}</p><ul>{backpack.items.map((item) => <li key={item.item_id}>{item.item_text}</li>)}</ul><button type="button" className="success-button" disabled={Boolean(busyKey) || !online} onClick={() => void reviewBackpack(backpack.checklistId)}>{busyKey === `backpack:${backpack.checklistId}` ? 'Подтверждаем…' : 'Подтвердить рюкзак'}</button></article>)}
    </div>
  </section>
}
