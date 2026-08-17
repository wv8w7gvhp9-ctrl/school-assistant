import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CloudBook } from '../domain/books'
import { groupBackpackReviews, reviewCountLabel, type BackpackReviewRow } from '../domain/reviews'
import { homeworkApprovalMessage } from '../domain/stars'
import { formatFullRussianDate } from '../domain/today'
import { supabase } from '../lib/supabase'
import { useOnlineStatus } from './NetworkStatus'
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
  familyId: string
  childId: string
  childName: string
  onReviewed: () => void
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Samara' }).format(new Date(`${value}T12:00:00+04:00`))
}

export function ParentReviewQueue({ familyId, childId, childName, onReviewed }: ReviewQueueProps) {
  const online = useOnlineStatus()
  const [homework, setHomework] = useState<HomeworkReview[]>([])
  const [books, setBooks] = useState<CloudBook[]>([])
  const [backpackRows, setBackpackRows] = useState<BackpackReviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [failedSections, setFailedSections] = useState<string[]>([])
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [actionError, setActionError] = useState('')

  const loadQueue = useCallback(async () => {
    if (!supabase) return
    if (!online) {
      setLoading(false)
      return
    }
    setLoading(true)
    setFailedSections([])
    setHomework([])
    setBooks([])
    setBackpackRows([])
    const [homeworkResult, booksResult, backpackResult] = await Promise.all([
      supabase.rpc('get_parent_homework_reviews'),
      supabase.from('books').select('id, title, author, status, started_on, finished_on, main_characters, summary, rating, review_status, updated_at').eq('family_id', familyId).eq('child_id', childId).eq('review_status', 'pending_review').order('updated_at'),
      supabase.rpc('get_parent_backpack_reviews'),
    ])
    const failed: string[] = []
    if (homeworkResult.error) {
      console.error('Не удалось загрузить домашку на проверку', homeworkResult.error)
      failed.push('домашку')
    }
    else setHomework((homeworkResult.data ?? []) as unknown as HomeworkReview[])
    if (booksResult.error) {
      console.error('Не удалось загрузить книги на проверку', booksResult.error)
      failed.push('книги')
    }
    else setBooks((booksResult.data ?? []) as CloudBook[])
    if (backpackResult.error) {
      console.error('Не удалось загрузить рюкзак на проверку', backpackResult.error)
      failed.push('рюкзак')
    }
    else setBackpackRows((backpackResult.data ?? []) as BackpackReviewRow[])
    setFailedSections(failed)
    setHasLoaded(true)
    setLoading(false)
  }, [familyId, childId, online])

  useEffect(() => { void loadQueue() }, [loadQueue])

  const backpacks = useMemo(() => groupBackpackReviews(backpackRows), [backpackRows])
  const counts = { homework: homework.length, book: books.length, backpack: backpacks.length }
  const total = counts.homework + counts.book + counts.backpack

  async function reviewHomework(id: string, decision: 'approved' | 'needs_revision') {
    if (!supabase || busyKey || !online) return
    setBusyKey(`homework:${id}`); setActionError(''); setMessage('')
    const { data, error } = await supabase.rpc('review_homework', { input_homework_id: id, input_decision: decision })
    if (error) {
      console.error('Не удалось сохранить решение по домашке', error)
      setActionError('Не удалось сохранить решение по домашке. Попробуйте ещё раз.')
    }
    else {
      setHomework((current) => current.filter((item) => item.id !== id))
      const stars = Number((data?.[0] as { stars_awarded?: number } | undefined)?.stars_awarded ?? 0)
      setMessage(decision === 'approved' ? homeworkApprovalMessage(stars) : 'Задание возвращено на доработку.')
      onReviewed()
    }
    setBusyKey(null)
  }

  async function reviewBook(id: string) {
    if (!supabase || busyKey || !online) return
    setBusyKey(`book:${id}`); setActionError(''); setMessage('')
    const { error } = await supabase.rpc('review_finished_book', { input_book_id: id })
    if (error) {
      console.error('Не удалось подтвердить книгу', error)
      setActionError('Не удалось подтвердить книгу. Попробуйте ещё раз.')
    }
    else { setBooks((current) => current.filter((book) => book.id !== id)); setMessage('Книга подтверждена. Начислены три звезды.'); onReviewed() }
    setBusyKey(null)
  }

  async function reviewBackpack(id: string) {
    if (!supabase || busyKey || !online) return
    setBusyKey(`backpack:${id}`); setActionError(''); setMessage('')
    const { error } = await supabase.rpc('review_backpack', { input_checklist_id: id })
    if (error) {
      console.error('Не удалось подтвердить рюкзак', error)
      setActionError('Не удалось подтвердить рюкзак. Попробуйте ещё раз.')
    }
    else { setBackpackRows((current) => current.filter((row) => row.checklist_id !== id)); setMessage('Рюкзак подтверждён. Начислена одна звезда.'); onReviewed() }
    setBusyKey(null)
  }

  return <section className="parent-review-queue" aria-labelledby="parent-review-title">
    <div className="parent-section-heading"><div><p className="eyebrow">Для родителя</p><h2 id="parent-review-title">Проверка</h2></div><span className="review-count" aria-label={reviewCountLabel(total)}>{total}</span></div>
    <p>Все работы ребёнка, которые ждут вашего решения, собраны здесь.</p>
    <div className="review-summary" aria-label={`Ожидают проверки: домашка ${counts.homework}, книги ${counts.book}, рюкзак ${counts.backpack}`}><span>Домашка <strong>{counts.homework}</strong></span><span>Книги <strong>{counts.book}</strong></span><span>Рюкзак <strong>{counts.backpack}</strong></span></div>
    {!online && <div className="auth-message warning" role="status"><strong>Нет интернета</strong><p>{hasLoaded ? 'Уже загруженные карточки можно просмотреть, но решение сохранится только после подключения.' : 'Подключитесь, чтобы загрузить очередь проверки.'}</p></div>}
    {loading && <p className="auth-loading" role="status">Собираем очередь проверки…</p>}
    {failedSections.length > 0 && <div className="auth-message error" role="alert"><p>Не удалось загрузить: {failedSections.join(', ')}.</p><button type="button" className="secondary-button" disabled={!online} onClick={() => void loadQueue()}>Повторить</button></div>}
    {actionError && <p className="auth-message error" role="alert">{actionError}</p>}
    {message && <p className="auth-message success" role="status">{message}</p>}
    {!loading && hasLoaded && total === 0 && failedSections.length === 0 && <div className="parent-empty review-empty"><strong>Всё проверено</strong><p>Новых работ от {childName} пока нет.</p><button type="button" className="text-button" onClick={() => void loadQueue()}>Обновить очередь</button></div>}
    <div className="review-list">
      {homework.map((item) => <article className="review-card" key={`homework:${item.id}`}><div className="review-card-heading"><span className="review-kind">Домашка</span><StatusChip status="pending_review" /></div><h3>{item.subject_title || 'Предмет'}</h3><p>{item.task}</p><small>К {formatDate(item.due_on)}{item.preferred_by ? ` · желательно до ${item.preferred_by.slice(0, 5)}` : ''}</small><div className="parent-review-actions"><button type="button" className="success-button" disabled={Boolean(busyKey) || !online} onClick={() => void reviewHomework(item.id, 'approved')}>{busyKey === `homework:${item.id}` ? 'Сохраняем…' : 'Подтвердить'}</button><button type="button" className="secondary-button" disabled={Boolean(busyKey) || !online} onClick={() => void reviewHomework(item.id, 'needs_revision')}>Вернуть на доработку</button></div></article>)}
      {books.map((book) => <article className="review-card" key={`book:${book.id}`}><div className="review-card-heading"><span className="review-kind">Книга</span><StatusChip status="pending_review" /></div><h3>{book.title}</h3><p>{book.author}</p>{book.main_characters && <p><strong>Ответ о героях:</strong> {book.main_characters}</p>}{book.summary && <p><strong>О книге:</strong> {book.summary}</p>}{book.rating && <p><strong>Оценка:</strong> {book.rating} из 5</p>}<button type="button" className="success-button" disabled={Boolean(busyKey) || !online} onClick={() => void reviewBook(book.id)}>{busyKey === `book:${book.id}` ? 'Подтверждаем…' : 'Подтвердить прочтение'}</button></article>)}
      {backpacks.map((backpack) => <article className="review-card" key={`backpack:${backpack.checklistId}`}><div className="review-card-heading"><span className="review-kind">Рюкзак</span><StatusChip status="pending_review" /></div><h3>Рюкзак собран</h3><p>На {formatFullRussianDate(backpack.targetDay).toLowerCase()}</p><ul>{backpack.items.map((item) => <li key={item.item_id}>{item.item_text}</li>)}</ul><button type="button" className="success-button" disabled={Boolean(busyKey) || !online} onClick={() => void reviewBackpack(backpack.checklistId)}>{busyKey === `backpack:${backpack.checklistId}` ? 'Подтверждаем…' : 'Подтвердить рюкзак'}</button></article>)}
    </div>
  </section>
}
