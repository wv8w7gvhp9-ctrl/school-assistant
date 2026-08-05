import { useEffect, useState, type FormEvent } from 'react'
import { bookStatusLabel, type CloudBook } from '../domain/books'
import { supabase } from '../lib/supabase'

export function ParentBooksEditor({ familyId, childId }: { familyId: string; childId: string }) {
  const [books, setBooks] = useState<CloudBook[]>([])
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function loadBooks() {
    if (!supabase) return
    const { data, error: requestError } = await supabase.from('books').select('id, title, author, status, started_on, finished_on, main_characters, summary, rating, review_status').eq('family_id', familyId).eq('child_id', childId).order('created_at', { ascending: false })
    if (requestError) throw requestError
    setBooks((data ?? []) as CloudBook[])
  }

  useEffect(() => {
    let active = true
    void loadBooks().catch(() => { if (active) setError('Не удалось загрузить книги. Проверьте интернет и попробуйте ещё раз.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [familyId, childId])

  async function saveBook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || saving || !title.trim() || !author.trim()) return
    setSaving(true); setError(''); setMessage('')
    const values = { title: title.trim(), author: author.trim(), updated_at: new Date().toISOString() }
    const request = editingId ? supabase.from('books').update(values).eq('id', editingId).eq('family_id', familyId) : supabase.from('books').insert({ ...values, family_id: familyId, child_id: childId })
    const { error: saveError } = await request
    if (saveError) setError('Не удалось сохранить книгу. Проверьте интернет и попробуйте ещё раз.')
    else { await loadBooks(); setTitle(''); setAuthor(''); setEditingId(null); setMessage(editingId ? 'Изменения книги сохранены.' : 'Книга добавлена ребёнку.') }
    setSaving(false)
  }

  async function deleteBook(id: string) {
    if (!supabase || busyId) return
    setBusyId(id); setError('')
    const { error: deleteError } = await supabase.from('books').delete().eq('id', id).eq('family_id', familyId)
    if (deleteError) setError('Не удалось удалить книгу. Проверьте интернет и попробуйте ещё раз.')
    else { setBooks((current) => current.filter((book) => book.id !== id)); setDeletingId(null); setMessage('Книга удалена.') }
    setBusyId(null)
  }

  async function confirmBook(id: string) {
    if (!supabase || busyId) return
    setBusyId(id); setError(''); setMessage('')
    const { error: reviewError } = await supabase.rpc('review_finished_book', { input_book_id: id })
    if (reviewError) setError('Не удалось подтвердить книгу. Обновите список и попробуйте ещё раз.')
    else { setBooks((current) => current.map((book) => book.id === id ? { ...book, review_status: 'approved' } : book)); setMessage('Книга подтверждена. Начислены три звезды.') }
    setBusyId(null)
  }

  const pending = books.filter((book) => book.review_status === 'pending_review')
  const otherBooks = books.filter((book) => book.review_status !== 'pending_review')

  return <section className="parent-books" aria-labelledby="parent-books-title"><div className="parent-section-heading"><div><p className="eyebrow">Для родителя</p><h2 id="parent-books-title">Книги</h2></div></div><p>Назначьте книгу ребёнку и посмотрите заполненный читательский дневник.</p>
    <form className="auth-form parent-book-form" onSubmit={saveBook}><h3>{editingId ? 'Изменить книгу' : 'Добавить книгу'}</h3><label htmlFor="parent-book-title">Название</label><input id="parent-book-title" type="text" maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например, Денискины рассказы" required /><label htmlFor="parent-book-author">Автор</label><input id="parent-book-author" type="text" maxLength={160} value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Например, Виктор Драгунский" required /><button type="submit" className="primary-button" disabled={saving}>{saving ? 'Сохраняем…' : editingId ? 'Сохранить изменения' : 'Добавить книгу'}</button>{editingId && <button type="button" className="secondary-button" onClick={() => { setEditingId(null); setTitle(''); setAuthor('') }}>Отменить изменение</button>}</form>
    {loading && <p className="auth-loading" role="status">Загружаем книги…</p>}{error && <p className="auth-message error" role="alert">{error}</p>}{message && <p className="auth-message success" role="status">{message}</p>}
    {!loading && pending.length > 0 && <div className="parent-book-list"><h3>Ждут подтверждения</h3>{pending.map((book) => <article className="parent-book-row review" key={book.id}><div><strong>{book.title}</strong><p>{book.author}</p></div>{book.started_on && <span>Начал: {book.started_on}</span>}{book.finished_on && <span>Закончил: {book.finished_on}</span>}{book.main_characters && <p><strong>Главные герои:</strong> {book.main_characters}</p>}{book.summary && <p><strong>Краткое содержание:</strong> {book.summary}</p>}{book.rating && <p><strong>Оценка:</strong> {book.rating} из 5</p>}<button type="button" className="success-button" disabled={Boolean(busyId)} onClick={() => void confirmBook(book.id)}>{busyId === book.id ? 'Подтверждаем…' : 'Подтвердить прочтение'}</button></article>)}</div>}
    {!loading && <div className="parent-book-list"><h3>Назначенные книги</h3>{books.length === 0 ? <p className="parent-empty">Книг пока нет. Добавьте первую книгу выше.</p> : otherBooks.length === 0 ? <p className="parent-empty">Все книги сейчас ожидают подтверждения.</p> : otherBooks.map((book) => <article className="parent-book-row" key={book.id}><div><strong>{book.title}</strong><p>{book.author}</p></div><span>{bookStatusLabel(book.status)}{book.rating ? ` · оценка ${book.rating} из 5` : ''}{book.review_status === 'approved' ? ' · подтверждено' : ''}</span><div className="parent-lesson-actions"><button type="button" onClick={() => { setEditingId(book.id); setTitle(book.title); setAuthor(book.author); setDeletingId(null) }}>Изменить</button><button type="button" onClick={() => setDeletingId(book.id)}>Удалить</button></div>{deletingId === book.id && <div className="parent-confirm"><p>Удалить книгу и весь заполненный дневник?</p><div><button type="button" className="secondary-button" onClick={() => setDeletingId(null)}>Оставить</button><button type="button" className="danger-button" disabled={busyId === book.id} onClick={() => void deleteBook(book.id)}>{busyId === book.id ? 'Удаляем…' : 'Удалить'}</button></div></div>}</article>)}</div>}
  </section>
}
