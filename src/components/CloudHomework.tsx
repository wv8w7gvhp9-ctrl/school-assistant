import { useEffect, useMemo, useState } from 'react'
import { filterHomework, homeworkProgress, preferredTimeLabel, samaraIsoDate, type CloudHomeworkAssignment, type HomeworkFilter } from '../domain/homework'
import { supabase } from '../lib/supabase'
import { StatusChip } from './UI'

const filters: HomeworkFilter[] = ['Сегодня', 'На завтра', 'Выполнено']

export function CloudHomework() {
  const [assignments, setAssignments] = useState<CloudHomeworkAssignment[]>([])
  const [filter, setFilter] = useState<HomeworkFilter>('Сегодня')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  async function loadHomework() {
    if (!supabase) return
    setState('loading')
    const { data, error } = await supabase.rpc('get_my_homework')
    if (error) {
      setState('error')
      return
    }
    setAssignments((data ?? []) as CloudHomeworkAssignment[])
    setState('ready')
  }

  useEffect(() => { void loadHomework() }, [])

  const today = samaraIsoDate()
  const visible = useMemo(() => filterHomework(assignments, filter, today), [assignments, filter, today])
  const progress = homeworkProgress(filterHomework(assignments, 'Сегодня', today))
  const actionable = visible.filter((assignment) => assignment.status !== 'approved')
  const approved = visible.filter((assignment) => assignment.status === 'approved')

  async function submitForReview(id: string) {
    if (!supabase || submittingId) return
    setSubmittingId(id)
    setMessage('')
    const { error } = await supabase.rpc('submit_my_homework_for_review', { input_homework_id: id })
    if (error) {
      setMessage('Не получилось отправить задание. Проверь интернет и попробуй ещё раз.')
    } else {
      setAssignments((current) => current.map((assignment) => assignment.id === id ? { ...assignment, status: 'pending_review' } : assignment))
      setMessage('Готово! Задание ждёт проверки родителя.')
    }
    setSubmittingId(null)
  }

  function HomeworkCard({ assignment }: { assignment: CloudHomeworkAssignment }) {
    const canSubmit = assignment.status === 'todo' || assignment.status === 'needs_revision'
    return <article className={`card homework-card homework-${assignment.status}`}>
      <div className="homework-meta"><span>{assignment.subject_title}</span><StatusChip status={assignment.status} /></div>
      <h2>{assignment.task}</h2>
      {preferredTimeLabel(assignment.preferred_by) && <p>{preferredTimeLabel(assignment.preferred_by)}</p>}
      {canSubmit && <button className="primary-button homework-submit" type="button" onClick={() => void submitForReview(assignment.id)} disabled={Boolean(submittingId)}>{submittingId === assignment.id ? 'Отправляем…' : 'Задание выполнено'}</button>}
    </article>
  }

  return <section className="screen"><div className="screen-heading"><div><p className="eyebrow">На сегодня и завтра</p><h1>Домашка</h1></div></div>
    <div className="filter-pills" aria-label="Показать домашние задания">{filters.map((item) => <button type="button" key={item} className={filter === item ? 'selected' : ''} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}</div>
    {filter === 'Сегодня' && <article className="progress-card"><div><span>Выполнено {progress.complete} из {progress.total}</span><strong>{progress.complete}/{progress.total}</strong></div><progress className="homework-progress" max={Math.max(progress.total, 1)} value={progress.complete} aria-label={`Выполнено ${progress.complete} из ${progress.total}`} /></article>}
    {state === 'loading' && <p className="child-cloud-state" role="status">Загружаем домашку…</p>}
    {state === 'error' && <div className="auth-message error" role="alert"><p>Не получилось загрузить домашку. Проверь интернет и попробуй ещё раз.</p><button type="button" className="secondary-button" onClick={() => void loadHomework()}>Повторить</button></div>}
    {message && <p className={message.startsWith('Готово') ? 'auth-message success' : 'auth-message error'} role={message.startsWith('Готово') ? 'status' : 'alert'}>{message}</p>}
    {state === 'ready' && visible.length === 0 && <div className="child-cloud-state"><strong>{filter === 'Выполнено' ? 'Подтверждённых заданий пока нет' : 'На этот день домашки пока нет'}</strong><p>{filter === 'Выполнено' ? 'Они появятся здесь после проверки родителя.' : 'Можно спокойно заняться другими делами.'}</p></div>}
    {state === 'ready' && actionable.length > 0 && <div className="homework-list">{actionable.map((assignment) => <HomeworkCard assignment={assignment} key={assignment.id} />)}</div>}
    {state === 'ready' && approved.length > 0 && <section className="approved-homework"><h2>{filter === 'Выполнено' ? 'Подтверждено' : 'Уже подтверждено'}</h2><div className="homework-list">{approved.map((assignment) => <HomeworkCard assignment={assignment} key={assignment.id} />)}</div></section>}
  </section>
}
