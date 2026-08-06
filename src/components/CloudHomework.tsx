import { useEffect, useMemo, useState } from 'react'
import { filterHomework, homeworkProgress, preferredTimeLabel, samaraIsoDate, type CloudHomeworkAssignment, type HomeworkFilter } from '../domain/homework'
import { supabase } from '../lib/supabase'
import { loadWithOfflineFallback, offlineKey } from '../lib/offlineCache'
import { enqueueHomeworkSubmission, listHomeworkMutations, notifyOfflineQueueChanged, offlineQueueSyncedEvent, type HomeworkSyncResult } from '../lib/offlineQueue'
import { Icon } from './Icon'
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
  const [message, setMessage] = useState<{ kind: 'success' | 'warning' | 'error'; text: string } | null>(null)
  const [cachedAt, setCachedAt] = useState<string | null>(null)
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set())

  async function loadHomework() {
    if (!supabase || !profile) return
    setState('loading')
    const result = await loadWithOfflineFallback<CloudHomeworkAssignment[]>(offlineKey.homework(profile.childId), () => supabase!.rpc('get_my_homework_v2'), online)
    if (result.source === 'none') {
      setState('error')
      return
    }
    setAssignments(result.data ?? [])
    setCachedAt(result.source === 'cache' ? result.savedAt : null)
    setState('ready')
  }

  useEffect(() => { void loadHomework() }, [online, profile])

  useEffect(() => {
    if (!profile) return
    const refreshQueued = async () => {
      const mutations = await listHomeworkMutations(profile.childId)
      setQueuedIds(new Set(mutations.map((mutation) => mutation.homeworkId)))
    }
    const handleSync = (event: Event) => {
      const detail = (event as CustomEvent<{ childId: string; results: HomeworkSyncResult[] }>).detail
      if (!detail || detail.childId !== profile.childId) return
      void refreshQueued()
      if (detail.results.some((result) => result.outcome === 'conflict' || result.outcome === 'missing')) {
        setMessage({ kind: 'warning', text: 'Задание изменилось у родителя. Проверь обновлённое задание.' })
      } else if (detail.results.some((result) => result.outcome === 'applied' || result.outcome === 'already_applied' || result.outcome === 'already_satisfied')) {
        setMessage({ kind: 'success', text: 'Готово! Задание отправлено родителю.' })
      } else {
        setMessage({ kind: 'warning', text: 'Действие сохранено на устройстве. Отправим при следующем подключении.' })
      }
      if (online) void loadHomework()
    }
    void refreshQueued()
    window.addEventListener(offlineQueueSyncedEvent, handleSync)
    return () => window.removeEventListener(offlineQueueSyncedEvent, handleSync)
  }, [online, profile])

  const today = samaraIsoDate()
  const visible = useMemo(() => filterHomework(assignments, filter, today), [assignments, filter, today])
  const todayAssignments = filterHomework(assignments, 'Сегодня', today)
  const cloudProgress = homeworkProgress(todayAssignments)
  const queuedToday = todayAssignments.filter((assignment) => queuedIds.has(assignment.id) && assignment.status !== 'pending_review' && assignment.status !== 'approved').length
  const progress = { complete: cloudProgress.complete + queuedToday, total: cloudProgress.total }
  const actionable = visible.filter((assignment) => assignment.status !== 'approved')
  const approved = visible.filter((assignment) => assignment.status === 'approved')

  async function submitForReview(id: string) {
    if (!profile || submittingId || queuedIds.has(id)) return
    const assignment = assignments.find((item) => item.id === id)
    if (!assignment?.updated_at) {
      setMessage({ kind: 'error', text: 'Не получилось сохранить действие. Обнови домашку с интернетом и попробуй ещё раз.' })
      return
    }
    setSubmittingId(id)
    setMessage(null)
    try {
      await enqueueHomeworkSubmission(profile.childId, id, assignment.updated_at)
      setQueuedIds((current) => new Set(current).add(id))
      setMessage(online
        ? { kind: 'warning', text: 'Действие сохранено. Отправляем родителю…' }
        : { kind: 'warning', text: 'Действие сохранено на устройстве. Отправим, когда появится интернет.' })
      notifyOfflineQueueChanged()
    } catch (error) {
      console.error('Не удалось сохранить действие в офлайн-очереди', error)
      setMessage({ kind: 'error', text: 'Не получилось сохранить действие на устройстве. Попробуй ещё раз.' })
    }
    setSubmittingId(null)
  }

  function HomeworkCard({ assignment }: { assignment: CloudHomeworkAssignment }) {
    const canSubmit = assignment.status === 'todo' || assignment.status === 'needs_revision'
    const queued = queuedIds.has(assignment.id)
    return <article className={`card homework-card homework-${assignment.status}`}>
      <div className="homework-meta"><span>{assignment.subject_title}</span>{queued ? <span className="status-chip pending_sync"><Icon name="clock" />Ждёт отправки</span> : <StatusChip status={assignment.status} />}</div>
      <h2>{assignment.task}</h2>
      {preferredTimeLabel(assignment.preferred_by) && <p>{preferredTimeLabel(assignment.preferred_by)}</p>}
      {canSubmit && <button className="primary-button homework-submit" type="button" onClick={() => void submitForReview(assignment.id)} disabled={Boolean(submittingId) || queued}>{submittingId === assignment.id ? 'Сохраняем…' : queued ? 'Ждёт отправки' : 'Задание выполнено'}</button>}
    </article>
  }

  return <section className="screen"><div className="screen-heading"><div><p className="eyebrow">На сегодня и завтра</p><h1>Домашка</h1></div></div>
    <div className="filter-pills" aria-label="Показать домашние задания">{filters.map((item) => <button type="button" key={item} className={filter === item ? 'selected' : ''} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}</div>
    {cachedAt && <OfflineDataNote savedAt={cachedAt} />}
    {filter === 'Сегодня' && <article className="progress-card"><div><span>Выполнено {progress.complete} из {progress.total}</span><strong>{progress.complete}/{progress.total}</strong></div><progress className="homework-progress" max={Math.max(progress.total, 1)} value={progress.complete} aria-label={`Выполнено ${progress.complete} из ${progress.total}`} /></article>}
    {state === 'loading' && <p className="child-cloud-state" role="status">Загружаем домашку…</p>}
    {state === 'error' && <div className="auth-message error" role="alert"><p>{online ? 'Не получилось загрузить домашку. Попробуй ещё раз.' : 'Сохранённой домашки на этом устройстве пока нет.'}</p><button type="button" className="secondary-button" onClick={() => void loadHomework()}>Повторить</button></div>}
    {message && <p className={`auth-message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
    {state === 'ready' && visible.length === 0 && <div className="child-cloud-state"><strong>{filter === 'Выполнено' ? 'Подтверждённых заданий пока нет' : 'На этот день домашки пока нет'}</strong><p>{filter === 'Выполнено' ? 'Они появятся здесь после проверки родителя.' : 'Можно спокойно заняться другими делами.'}</p></div>}
    {state === 'ready' && actionable.length > 0 && <div className="homework-list">{actionable.map((assignment) => <HomeworkCard assignment={assignment} key={assignment.id} />)}</div>}
    {state === 'ready' && approved.length > 0 && <section className="approved-homework"><h2>{filter === 'Выполнено' ? 'Подтверждено' : 'Уже подтверждено'}</h2><div className="homework-list">{approved.map((assignment) => <HomeworkCard assignment={assignment} key={assignment.id} />)}</div></section>}
  </section>
}
