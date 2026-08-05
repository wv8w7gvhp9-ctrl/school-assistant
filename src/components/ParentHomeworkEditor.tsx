import { useEffect, useState, type FormEvent } from 'react'
import { addDays, samaraIsoDate, validateHomeworkDraft, type HomeworkDraft } from '../domain/homework'
import type { HomeworkStatus } from '../domain/types'
import { supabase } from '../lib/supabase'
import { StatusChip } from './UI'

type ParentHomework = {
  id: string
  subject_id: string
  due_on: string
  preferred_by: string | null
  task: string
  status: HomeworkStatus
  subject: { title: string } | { title: string }[] | null
}

const emptyDraft = (): HomeworkDraft => ({ subject: '', dueOn: addDays(samaraIsoDate(), 1), preferredBy: '', task: '' })

function subjectTitle(homework: ParentHomework) {
  return Array.isArray(homework.subject) ? homework.subject[0]?.title ?? 'Предмет' : homework.subject?.title ?? 'Предмет'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Samara' }).format(new Date(`${value}T12:00:00+04:00`))
}

export function ParentHomeworkEditor({ familyId, childId }: { familyId: string; childId: string }) {
  const [assignments, setAssignments] = useState<ParentHomework[]>([])
  const [draft, setDraft] = useState<HomeworkDraft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function loadHomework() {
    if (!supabase) return
    const { data, error: requestError } = await supabase
      .from('homework_assignments')
      .select('id, subject_id, due_on, preferred_by, task, status, subject:subjects(title)')
      .eq('family_id', familyId)
      .eq('child_id', childId)
      .order('due_on')
      .order('created_at')
    if (requestError) throw requestError
    setAssignments((data ?? []) as unknown as ParentHomework[])
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    void loadHomework().catch(() => {
      if (active) setError('Не удалось загрузить домашние задания. Проверьте интернет и попробуйте ещё раз.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [familyId, childId])

  async function findOrCreateSubject(title: string) {
    if (!supabase) throw new Error('Cloud is unavailable')
    const existing = await supabase.from('subjects').select('id').eq('family_id', familyId).eq('title', title).maybeSingle()
    if (existing.error) throw existing.error
    if (existing.data) return (existing.data as { id: string }).id
    const created = await supabase.from('subjects').insert({ family_id: familyId, title }).select('id').single()
    if (created.error && created.error.code !== '23505') throw created.error
    if (created.data) return (created.data as { id: string }).id
    const retried = await supabase.from('subjects').select('id').eq('family_id', familyId).eq('title', title).single()
    if (retried.error) throw retried.error
    return (retried.data as { id: string }).id
  }

  async function saveHomework(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || saving) return
    const validationError = validateHomeworkDraft(draft)
    if (validationError) { setError(validationError); return }
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const subjectId = await findOrCreateSubject(draft.subject.trim())
      const values = { subject_id: subjectId, due_on: draft.dueOn, preferred_by: draft.preferredBy || null, task: draft.task.trim(), updated_at: new Date().toISOString() }
      const request = editingId
        ? supabase.from('homework_assignments').update(values).eq('id', editingId).eq('family_id', familyId)
        : supabase.from('homework_assignments').insert({ ...values, family_id: familyId, child_id: childId, status: 'todo' })
      const { error: saveError } = await request
      if (saveError) throw saveError
      await loadHomework()
      setMessage(editingId ? 'Изменения задания сохранены.' : 'Домашнее задание добавлено.')
      setEditingId(null)
      setDraft(emptyDraft())
    } catch {
      setError('Не удалось сохранить задание. Проверьте интернет и попробуйте ещё раз.')
    } finally {
      setSaving(false)
    }
  }

  function beginEditing(homework: ParentHomework) {
    setEditingId(homework.id)
    setDeletingId(null)
    setDraft({ subject: subjectTitle(homework), dueOn: homework.due_on, preferredBy: homework.preferred_by?.slice(0, 5) ?? '', task: homework.task })
    setError('')
    setMessage('')
  }

  async function deleteHomework(id: string) {
    if (!supabase || busyId) return
    setBusyId(id)
    setError('')
    const { error: deleteError } = await supabase.from('homework_assignments').delete().eq('id', id).eq('family_id', familyId)
    if (deleteError) setError('Не удалось удалить задание. Проверьте интернет и попробуйте ещё раз.')
    else {
      setAssignments((current) => current.filter((assignment) => assignment.id !== id))
      setDeletingId(null)
      setMessage('Домашнее задание удалено.')
    }
    setBusyId(null)
  }

  async function reviewHomework(id: string, decision: 'approved' | 'needs_revision') {
    if (!supabase || busyId) return
    setBusyId(id)
    setError('')
    setMessage('')
    const { error: reviewError } = await supabase.rpc('review_homework', { input_homework_id: id, input_decision: decision })
    if (reviewError) setError('Не удалось сохранить решение. Обновите список и попробуйте ещё раз.')
    else {
      setAssignments((current) => current.map((assignment) => assignment.id === id ? { ...assignment, status: decision } : assignment))
      setMessage(decision === 'approved' ? 'Задание подтверждено. Начислена одна звезда.' : 'Задание возвращено на доработку.')
    }
    setBusyId(null)
  }

  const pending = assignments.filter((assignment) => assignment.status === 'pending_review')
  const rest = assignments.filter((assignment) => assignment.status !== 'pending_review')

  return <section className="parent-homework" aria-labelledby="parent-homework-title">
    <div className="parent-section-heading"><div><p className="eyebrow">Для родителя</p><h2 id="parent-homework-title">Домашка</h2></div></div>
    <p>Добавьте задание, а после выполнения подтвердите его или верните на доработку.</p>
    <form className="auth-form parent-homework-form" onSubmit={saveHomework}>
      <h3>{editingId ? 'Изменить задание' : 'Добавить задание'}</h3>
      <label htmlFor="homework-subject">Предмет</label><input id="homework-subject" type="text" maxLength={80} value={draft.subject} onChange={(event) => setDraft((current) => ({ ...current, subject: event.target.value }))} placeholder="Например, Математика" required />
      <label htmlFor="homework-task">Что нужно сделать</label><textarea id="homework-task" maxLength={2000} value={draft.task} onChange={(event) => setDraft((current) => ({ ...current, task: event.target.value }))} placeholder="Например, решить № 4 и 5 на странице 32" required />
      <div className="parent-form-grid"><div><label htmlFor="homework-due">Сделать к дате</label><input id="homework-due" type="date" value={draft.dueOn} onChange={(event) => setDraft((current) => ({ ...current, dueOn: event.target.value }))} required /></div><div><label htmlFor="homework-time">Желательно до</label><input id="homework-time" type="time" value={draft.preferredBy} onChange={(event) => setDraft((current) => ({ ...current, preferredBy: event.target.value }))} /></div></div>
      <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Сохраняем…' : editingId ? 'Сохранить изменения' : 'Добавить задание'}</button>
      {editingId && <button className="secondary-button" type="button" onClick={() => { setEditingId(null); setDraft(emptyDraft()); setError('') }}>Отменить изменение</button>}
    </form>
    {loading && <p className="auth-loading" role="status">Загружаем домашние задания…</p>}
    {error && <p className="auth-message error" role="alert">{error}</p>}
    {message && <p className="auth-message success" role="status">{message}</p>}
    {!loading && pending.length > 0 && <div className="parent-homework-list"><h3>Ждут проверки</h3>{pending.map((homework) => <article className="parent-homework-row review" key={homework.id}><div className="parent-homework-heading"><strong>{subjectTitle(homework)}</strong><StatusChip status={homework.status} /></div><p>{homework.task}</p><span>К {formatDate(homework.due_on)}{homework.preferred_by ? ` · желательно до ${homework.preferred_by.slice(0, 5)}` : ''}</span><div className="parent-review-actions"><button type="button" className="success-button" disabled={Boolean(busyId)} onClick={() => void reviewHomework(homework.id, 'approved')}>{busyId === homework.id ? 'Сохраняем…' : 'Подтвердить'}</button><button type="button" className="secondary-button" disabled={Boolean(busyId)} onClick={() => void reviewHomework(homework.id, 'needs_revision')}>Вернуть на доработку</button></div></article>)}</div>}
    {!loading && <div className="parent-homework-list"><h3>Все задания</h3>{assignments.length === 0 ? <p className="parent-empty">Заданий пока нет. Добавьте первое задание выше.</p> : rest.map((homework) => <article className="parent-homework-row" key={homework.id}><div className="parent-homework-heading"><strong>{subjectTitle(homework)}</strong><StatusChip status={homework.status} /></div><p>{homework.task}</p><span>К {formatDate(homework.due_on)}{homework.preferred_by ? ` · желательно до ${homework.preferred_by.slice(0, 5)}` : ''}</span><div className="parent-lesson-actions"><button type="button" onClick={() => beginEditing(homework)}>Изменить</button><button type="button" onClick={() => setDeletingId(homework.id)}>Удалить</button></div>{deletingId === homework.id && <div className="parent-confirm"><p>Удалить это задание? Оно исчезнет и на устройстве ребёнка.</p><div><button type="button" className="secondary-button" onClick={() => setDeletingId(null)}>Оставить</button><button type="button" className="danger-button" disabled={busyId === homework.id} onClick={() => void deleteHomework(homework.id)}>{busyId === homework.id ? 'Удаляем…' : 'Удалить'}</button></div></div>}</article>)}</div>}
  </section>
}
