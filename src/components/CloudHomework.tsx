import { useEffect, useMemo, useState } from 'react'
import { filterHomework, homeworkProgress, preferredTimeLabel, samaraIsoDate, type CloudHomeworkAssignment, type HomeworkFilter } from '../domain/homework'
import { supabase } from '../lib/supabase'
import { loadWithOfflineFallback, offlineKey, saveOfflineSnapshot } from '../lib/offlineCache'
import { StatusChip } from './UI'
import { useChildSession } from './ChildSession'
import { OfflineDataNote, useOnlineStatus } from './NetworkStatus'

const filters: HomeworkFilter[] = ['Сегодня', 'На завтра', 'Выполнено']

export function CloudHomework() {
  const profile = useChildSession()
  const online = useOnlineStatus()
  const [assignments, setAssignments] = useState<CloudHomeworkAssignment[]>([])
  const [filter, setFilter] = useState<HomeworkFilter>('Сегодня')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [cachedAt, setCachedAt] = useState<string | null>(null)

  async function loadHomework() {
    if (!supabase || !profile) return
    setState('loading')
    const result = await loadWithOfflineFallback<CloudHomeworkAssignment[]>(offlineKey.homework(profile.childId), () => supabase!.rpc('get_my_homework'), online)
    if (result.source === 'none') {
      setState('error')
      return
    }
    setAssignments(result.data ?? [])
    setCachedAt(result.source === 'cache' ? result.savedAt : null)
    setState('ready')
  }

  useEffect(() => { void loadHomework() }, [online, profile])

  const today = samaraIsoDate()
  const visible = useMemo(() => filterHomework(assignments, filter, today), [assignments, filter, today])
  const progress = homeworkProgress(filterHomework(assignments, 'Сегодня', today))
  const actionable = visible.filter((assignment) => assignment.status !== 'approved')
  const approved = visible.filter((assignment) => assignment.status === 'approved')

  async function submitForReview(id: string) {
    if (!supabase || !profile || submittingId) return
    if (!online) { setMessage('Подключись к интернету, чтобы отправить задание.'); return }
    setSubmittingId(id)
    setMessage('')
    const { error } = await supabase.rpc('submit_my_homework_for_review', { input_homework_id: id })
    if (error) {
      setMessage('Не получилось отправить задание. Проверь интернет и попробуй ещё раз.')
    } else {
      const updated = assignments.map((assignment) => assignment.id === id ? { ...assignment, status: 'pending_review' as const } : assignment)
      setAssignments(updated)
      await saveOfflineSnapshot(offlineKey.homework(profile.childId), updated)
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
      {canSubmit && <button className="primary-button homework-submit" type="button" onClick={() => void submitForReview(assignment.id)} disabled={Boolean(submittingId) || !online}>{submittingId === assignment.id ? 'Отправляем…' : online ? 'Задание выполнено' : 'Нужен интернет'}</button>}
    </article>
  }

  return <section className="screen"><div className="screen-heading"><div><p className="eyebrow">На сегодня и завтра</p><h1>Домашка</h1></div></div>
    <div className="filter-pills" aria-label="Показать домашние задания">{filters.map((item) => <button type="button" key={item} className={filter === item ? 'selected' : ''} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}</div>
    {cachedAt && <OfflineDataNote savedAt={cachedAt} />}
    {filter === 'Сегодня' && <article className="progress-card"><div><span>Выполнено {progress.complete} из {progress.total}</span><strong>{progress.complete}/{progress.total}</strong></div><progress className="homework-progress" max={Math.max(progress.total, 1)} value={progress.complete} aria-label={`Выполнено ${progress.complete} из ${progress.total}`} /></article>}
    {state === 'loading' && <p className="child-cloud-state" role="status">Загружаем домашку…</p>}
    {state === 'error' && <div className="auth-message error" role="alert"><p>{online ? 'Не получилось загрузить домашку. Попробуй ещё раз.' : 'Сохранённой домашки на этом устройстве пока нет.'}</p><button type="button" className="secondary-button" onClick={() => void loadHomework()}>Повторить</button></div>}
    {message && <p className={message.startsWith('Готово') ? 'auth-message success' : 'auth-message error'} role={message.startsWith('Готово') ? 'status' : 'alert'}>{message}</p>}
    {state === 'ready' && visible.length === 0 && <div className="child-cloud-state"><strong>{filter === 'Выполнено' ? 'Подтверждённых заданий пока нет' : 'На этот день домашки пока нет'}</strong><p>{filter === 'Выполнено' ? 'Они появятся здесь после проверки родителя.' : 'Можно спокойно заняться другими делами.'}</p></div>}
    {state === 'ready' && actionable.length > 0 && <div className="homework-list">{actionable.map((assignment) => <HomeworkCard assignment={assignment} key={assignment.id} />)}</div>}
    {state === 'ready' && approved.length > 0 && <section className="approved-homework"><h2>{filter === 'Выполнено' ? 'Подтверждено' : 'Уже подтверждено'}</h2><div className="homework-list">{approved.map((assignment) => <HomeworkCard assignment={assignment} key={assignment.id} />)}</div></section>}
  </section>
}
