import { useEffect, useMemo, useState } from 'react'
import { formatFullRussianDate } from '../domain/today'
import { supabase } from '../lib/supabase'

type ReviewRow = {
  checklist_id: string
  child_name: string
  target_day: string
  status: 'pending_review'
  item_id: string
  item_text: string
  checked: boolean
}

export function ParentBackpackReview() {
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  async function loadReviews() {
    if (!supabase) return
    setState('loading')
    const { data, error } = await supabase.rpc('get_parent_backpack_reviews')
    if (error) {
      console.error('Не удалось загрузить рюкзаки на проверку', error)
      setState('error')
      return
    }
    setRows((data ?? []) as ReviewRow[])
    setState('ready')
  }

  useEffect(() => { void loadReviews() }, [])

  const reviews = useMemo(() => {
    const grouped = new Map<string, { checklistId: string; childName: string; targetDay: string; items: ReviewRow[] }>()
    for (const row of rows) {
      const current = grouped.get(row.checklist_id) ?? { checklistId: row.checklist_id, childName: row.child_name, targetDay: row.target_day, items: [] }
      current.items.push(row)
      grouped.set(row.checklist_id, current)
    }
    return [...grouped.values()]
  }, [rows])

  async function approve(checklistId: string) {
    if (!supabase || busyId) return
    setBusyId(checklistId)
    setMessage('')
    const { error } = await supabase.rpc('review_backpack', { input_checklist_id: checklistId })
    if (error) {
      console.error('Не удалось подтвердить рюкзак', error)
      setMessage('Не удалось подтвердить рюкзак. Обновите список и попробуйте ещё раз.')
    } else {
      setRows((current) => current.filter((row) => row.checklist_id !== checklistId))
      setMessage('Рюкзак подтверждён. Начислена одна звезда.')
    }
    setBusyId(null)
  }

  return <section className="parent-backpack" aria-labelledby="parent-backpack-title"><div className="parent-section-heading"><div><p className="eyebrow">Для родителя</p><h2 id="parent-backpack-title">Рюкзак</h2></div></div><p>Подтвердите полностью собранный рюкзак после личной проверки.</p>
    {state === 'loading' && <p className="auth-loading" role="status">Проверяем рюкзаки…</p>}
    {state === 'error' && <div className="auth-message error" role="alert"><p>Не удалось загрузить рюкзаки.</p><button type="button" className="secondary-button" onClick={() => void loadReviews()}>Повторить</button></div>}
    {message && <p className={message.startsWith('Рюкзак подтверждён') ? 'auth-message success' : 'auth-message error'} role={message.startsWith('Рюкзак подтверждён') ? 'status' : 'alert'}>{message}</p>}
    {state === 'ready' && reviews.length === 0 && <div className="parent-empty"><p>Собранных рюкзаков на проверке пока нет.</p><button type="button" className="text-button" onClick={() => void loadReviews()}>Обновить список</button></div>}
    {reviews.map((review) => <article className="parent-backpack-review" key={review.checklistId}><div><strong>{review.childName}</strong><p>На {formatFullRussianDate(review.targetDay).toLowerCase()}</p></div><ul>{review.items.map((item) => <li key={item.item_id}>{item.item_text}</li>)}</ul><button type="button" className="success-button" disabled={Boolean(busyId)} onClick={() => void approve(review.checklistId)}>{busyId === review.checklistId ? 'Подтверждаем…' : 'Подтвердить рюкзак'}</button></article>)}
  </section>
}
