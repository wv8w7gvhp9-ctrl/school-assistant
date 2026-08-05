import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { parseThings, schoolYearDefaults, validateLessonDraft, validateOptionalTimeRange } from '../domain/schedule'
import { supabase } from '../lib/supabase'

type AcademicYear = { id: string; starts_on: string; ends_on: string }
type WeeklyLesson = {
  id: string
  subject_id: string
  weekday: number
  lesson_order: number
  starts_at: string
  ends_at: string
  things: string[]
  subject: { title: string } | { title: string }[] | null
}

type EditorLessonDraft = {
  subject: string
  weekday: string
  lessonOrder: string
  startsAt: string
  endsAt: string
  things: string
}

const emptyLessonDraft: EditorLessonDraft = { subject: '', weekday: '1', lessonOrder: '1', startsAt: '08:30', endsAt: '09:15', things: '' }

const weekdays = [
  { value: 1, label: 'Понедельник' },
  { value: 2, label: 'Вторник' },
  { value: 3, label: 'Среда' },
  { value: 4, label: 'Четверг' },
  { value: 5, label: 'Пятница' },
]

function subjectTitle(lesson: WeeklyLesson) {
  return Array.isArray(lesson.subject) ? lesson.subject[0]?.title ?? 'Предмет' : lesson.subject?.title ?? 'Предмет'
}

function localTime(value: string) {
  return value.slice(0, 5)
}

function LessonFields({ draft, setDraft }: { draft: EditorLessonDraft; setDraft: Dispatch<SetStateAction<EditorLessonDraft>> }) {
  return <>
    <label htmlFor="lesson-subject">Предмет</label>
    <input id="lesson-subject" type="text" maxLength={80} value={draft.subject} onChange={(event) => setDraft((current) => ({ ...current, subject: event.target.value }))} placeholder="Например, Математика" required />
    <div className="parent-form-grid"><div><label htmlFor="lesson-weekday">День</label><select id="lesson-weekday" className="parent-select" value={draft.weekday} onChange={(event) => setDraft((current) => ({ ...current, weekday: event.target.value }))}>{weekdays.map((day) => <option value={day.value} key={day.value}>{day.label}</option>)}</select></div><div><label htmlFor="lesson-order">Номер урока</label><input id="lesson-order" type="number" min="1" inputMode="numeric" value={draft.lessonOrder} onChange={(event) => setDraft((current) => ({ ...current, lessonOrder: event.target.value }))} required /></div></div>
    <div className="parent-form-grid"><div><label htmlFor="lesson-start">Начало</label><input id="lesson-start" type="time" value={draft.startsAt} onChange={(event) => setDraft((current) => ({ ...current, startsAt: event.target.value }))} required /></div><div><label htmlFor="lesson-end">Окончание</label><input id="lesson-end" type="time" value={draft.endsAt} onChange={(event) => setDraft((current) => ({ ...current, endsAt: event.target.value }))} required /></div></div>
    <label htmlFor="lesson-things">Что взять с собой</label>
    <input id="lesson-things" type="text" value={draft.things} onChange={(event) => setDraft((current) => ({ ...current, things: event.target.value }))} placeholder="Тетрадь, учебник, ручка" />
    <p className="field-help">Перечислите вещи через запятую. Повторы будут объединены.</p>
  </>
}

export function ParentScheduleEditor({ familyId }: { familyId: string }) {
  const defaults = useMemo(() => schoolYearDefaults(), [])
  const [years, setYears] = useState<AcademicYear[]>([])
  const [selectedYearId, setSelectedYearId] = useState('')
  const [lessons, setLessons] = useState<WeeklyLesson[]>([])
  const [loading, setLoading] = useState(true)
  const [savingYear, setSavingYear] = useState(false)
  const [savingLesson, setSavingLesson] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [yearDraft, setYearDraft] = useState(defaults)
  const [lessonDraft, setLessonDraft] = useState<EditorLessonDraft>(emptyLessonDraft)
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null)
  const [originalEditDraft, setOriginalEditDraft] = useState<EditorLessonDraft | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [lessonPendingDeletion, setLessonPendingDeletion] = useState<WeeklyLesson | null>(null)
  const [deletingLesson, setDeletingLesson] = useState(false)
  const [cancellationDate, setCancellationDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [cancellationLessonId, setCancellationLessonId] = useState('')
  const [savingCancellation, setSavingCancellation] = useState(false)
  const [exceptionKind, setExceptionKind] = useState<'cancelled' | 'replacement'>('cancelled')
  const [replacementDraft, setReplacementDraft] = useState({ subject: '', startsAt: '', endsAt: '', things: '' })

  const loadYears = async () => {
    const client = supabase
    if (!client) return
    const { data, error: requestError } = await client
      .from('academic_years')
      .select('id, starts_on, ends_on')
      .eq('family_id', familyId)
      .order('starts_on', { ascending: false })

    if (requestError) throw requestError
    const nextYears = (data ?? []) as AcademicYear[]
    setYears(nextYears)
    setSelectedYearId((current) => current || nextYears[0]?.id || '')
  }

  const loadLessons = async (yearId: string) => {
    const client = supabase
    if (!client || !yearId) {
      setLessons([])
      return
    }
    const { data, error: requestError } = await client
      .from('weekly_lessons')
      .select('id, subject_id, weekday, lesson_order, starts_at, ends_at, things, subject:subjects(title)')
      .eq('family_id', familyId)
      .eq('academic_year_id', yearId)
      .order('weekday')
      .order('lesson_order')

    if (requestError) throw requestError
    setLessons((data ?? []) as unknown as WeeklyLesson[])
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void loadYears().catch(() => {
      if (active) setError('Не удалось загрузить расписание. Проверьте интернет и попробуйте ещё раз.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [familyId])

  useEffect(() => {
    if (!selectedYearId) return
    setLoading(true)
    void loadLessons(selectedYearId).catch(() => {
      setError('Не удалось загрузить уроки. Проверьте интернет и попробуйте ещё раз.')
    }).finally(() => setLoading(false))
  }, [selectedYearId])

  async function createYear(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    if (!yearDraft.startsOn || !yearDraft.endsOn || yearDraft.endsOn < yearDraft.startsOn) {
      setError('Дата окончания учебного года должна быть позже даты начала.')
      return
    }
    setSavingYear(true)
    setError('')
    setMessage('')
    const { data, error: insertError } = await supabase
      .from('academic_years')
      .insert({ family_id: familyId, starts_on: yearDraft.startsOn, ends_on: yearDraft.endsOn })
      .select('id, starts_on, ends_on')
      .single()
    setSavingYear(false)
    if (insertError) {
      setError(insertError.code === '23505' ? 'Такой учебный год уже есть.' : 'Не удалось сохранить учебный год. Проверьте интернет и попробуйте ещё раз.')
      return
    }
    const newYear = data as AcademicYear
    setYears((current) => [newYear, ...current])
    setSelectedYearId(newYear.id)
    setMessage('Учебный год сохранён. Теперь добавьте уроки.')
  }

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

  async function createLesson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !selectedYearId) return
    const validationError = validateLessonDraft(lessonDraft)
    if (validationError) {
      setError(validationError)
      return
    }
    setSavingLesson(true)
    setError('')
    setMessage('')
    try {
      const title = lessonDraft.subject.trim()
      const subjectId = await findOrCreateSubject(title)
      const payload = {
        subject_id: subjectId,
        weekday: Number(lessonDraft.weekday),
        lesson_order: Number(lessonDraft.lessonOrder),
        starts_at: lessonDraft.startsAt,
        ends_at: lessonDraft.endsAt,
        things: parseThings(lessonDraft.things),
      }
      const request = editingLessonId
        ? supabase.from('weekly_lessons').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editingLessonId).eq('family_id', familyId)
        : supabase.from('weekly_lessons').insert({ ...payload, family_id: familyId, academic_year_id: selectedYearId })
      const { error: saveError } = await request
      if (saveError) {
        setError(saveError.code === '23505'
          ? 'В этот день уже есть урок с таким порядковым номером.'
          : 'Не удалось сохранить урок. Проверьте интернет и попробуйте ещё раз.')
        return
      }
      await loadLessons(selectedYearId)
      const wasEditing = Boolean(editingLessonId)
      setEditingLessonId(null)
      setOriginalEditDraft(null)
      setLessonDraft(wasEditing ? emptyLessonDraft : { ...lessonDraft, subject: '', lessonOrder: String(Number(lessonDraft.lessonOrder) + 1), things: '' })
      setMessage(wasEditing ? 'Изменения урока сохранены.' : 'Урок сохранён в недельном расписании.')
    } catch {
      setError('Не удалось сохранить урок. Проверьте интернет и попробуйте ещё раз.')
    } finally {
      setSavingLesson(false)
    }
  }

  function beginEditing(lesson: WeeklyLesson) {
    const draft: EditorLessonDraft = {
      subject: subjectTitle(lesson),
      weekday: String(lesson.weekday),
      lessonOrder: String(lesson.lesson_order),
      startsAt: localTime(lesson.starts_at),
      endsAt: localTime(lesson.ends_at),
      things: lesson.things.join(', '),
    }
    setEditingLessonId(lesson.id)
    setOriginalEditDraft(draft)
    setLessonDraft(draft)
    setLessonPendingDeletion(null)
    setConfirmDiscard(false)
    setError('')
    setMessage('')
  }

  function finishEditing() {
    setEditingLessonId(null)
    setOriginalEditDraft(null)
    setConfirmDiscard(false)
    setLessonDraft(emptyLessonDraft)
  }

  function requestCancelEditing() {
    if (editingLessonId && originalEditDraft && JSON.stringify(originalEditDraft) !== JSON.stringify(lessonDraft)) {
      setConfirmDiscard(true)
      return
    }
    finishEditing()
  }

  async function deleteLesson() {
    if (!supabase || !lessonPendingDeletion || !selectedYearId) return
    setDeletingLesson(true)
    setError('')
    const { error: deleteError } = await supabase.from('weekly_lessons').delete().eq('id', lessonPendingDeletion.id).eq('family_id', familyId)
    setDeletingLesson(false)
    if (deleteError) {
      setError('Не удалось удалить урок. Проверьте интернет и попробуйте ещё раз.')
      return
    }
    if (editingLessonId === lessonPendingDeletion.id) finishEditing()
    setLessonPendingDeletion(null)
    await loadLessons(selectedYearId)
    setMessage('Урок удалён из недельного расписания.')
  }

  async function saveLessonException(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !cancellationDate || !cancellationLessonId) return
    const timeError = exceptionKind === 'replacement' ? validateOptionalTimeRange(replacementDraft.startsAt, replacementDraft.endsAt) : null
    if (timeError) { setError(timeError); return }
    if (exceptionKind === 'replacement' && !replacementDraft.subject.trim()) { setError('Введите предмет для замены.'); return }
    setSavingCancellation(true)
    setError('')
    setMessage('')
    let subjectId: string | null = null
    try {
      subjectId = exceptionKind === 'replacement' ? await findOrCreateSubject(replacementDraft.subject.trim()) : null
    } catch {
      setSavingCancellation(false)
      setError('Не удалось подготовить замену. Проверьте интернет и попробуйте ещё раз.')
      return
    }
    const { error: cancellationError } = await supabase.from('lesson_exceptions').insert({
      family_id: familyId,
      day: cancellationDate,
      weekly_lesson_id: cancellationLessonId,
      kind: exceptionKind,
      subject_id: subjectId,
      starts_at: replacementDraft.startsAt || null,
      ends_at: replacementDraft.endsAt || null,
      things: exceptionKind === 'replacement' && replacementDraft.things.trim() ? parseThings(replacementDraft.things) : null,
    })
    setSavingCancellation(false)
    if (cancellationError) {
      setError(cancellationError.code === '23505'
        ? 'Для этого урока на эту дату изменение уже сохранено.'
        : 'Не удалось сохранить изменение. Проверьте интернет и попробуйте ещё раз.')
      return
    }
    setMessage(exceptionKind === 'cancelled' ? 'Отмена урока на выбранную дату сохранена.' : 'Замена урока на выбранную дату сохранена.')
  }

  const selectedYear = years.find((year) => year.id === selectedYearId)

  return <section className="parent-schedule" aria-labelledby="parent-schedule-title">
    <div className="parent-section-heading"><div><p className="eyebrow">Для родителя</p><h2 id="parent-schedule-title">Недельное расписание</h2></div></div>
    <p>Сначала выберите учебный год, затем добавьте уроки с понедельника по пятницу.</p>
    {loading && <p className="auth-loading" role="status">Загружаем расписание…</p>}
    {!loading && years.length === 0 && <form className="auth-form" onSubmit={createYear}>
      <label htmlFor="year-start">Начало учебного года</label>
      <input id="year-start" type="date" value={yearDraft.startsOn} onChange={(event) => setYearDraft((current) => ({ ...current, startsOn: event.target.value }))} required />
      <label htmlFor="year-end">Окончание учебного года</label>
      <input id="year-end" type="date" value={yearDraft.endsOn} onChange={(event) => setYearDraft((current) => ({ ...current, endsOn: event.target.value }))} required />
      <button className="primary-button" type="submit" disabled={savingYear}>{savingYear ? 'Сохраняем…' : 'Сохранить учебный год'}</button>
    </form>}
    {!loading && years.length > 0 && <>
      <label className="parent-select-label" htmlFor="academic-year">Учебный год</label>
      <select id="academic-year" className="parent-select" value={selectedYearId} disabled={Boolean(editingLessonId)} onChange={(event) => { setSelectedYearId(event.target.value); setError(''); setMessage('') }}>
        {years.map((year) => <option value={year.id} key={year.id}>{year.starts_on} — {year.ends_on}</option>)}
      </select>
      {selectedYear && !editingLessonId && <form className="auth-form" onSubmit={createLesson}>
        <h3>Добавить урок</h3>
        <LessonFields draft={lessonDraft} setDraft={setLessonDraft} />
        <button className="primary-button" type="submit" disabled={savingLesson}>{savingLesson ? 'Сохраняем…' : 'Добавить урок'}</button>
      </form>}
      {selectedYear && lessons.length > 0 && <form className="parent-exception-form" onSubmit={saveLessonException}>
        <h3>Изменить урок на дату</h3>
        <p>Недельное расписание не изменится: это изменение подействует только в выбранный день.</p>
        <label htmlFor="cancellation-date">Дата</label>
        <input id="cancellation-date" type="date" value={cancellationDate} onChange={(event) => setCancellationDate(event.target.value)} required />
        <label htmlFor="cancellation-lesson">Урок</label>
        <select id="cancellation-lesson" className="parent-select" value={cancellationLessonId} onChange={(event) => setCancellationLessonId(event.target.value)} required>
          <option value="" disabled>Выберите урок</option>
          {lessons.map((lesson) => <option value={lesson.id} key={lesson.id}>{weekdays.find((day) => day.value === lesson.weekday)?.label}: {lesson.lesson_order}. {subjectTitle(lesson)} · {localTime(lesson.starts_at)}</option>)}
        </select>
        <label htmlFor="exception-kind">Действие</label>
        <select id="exception-kind" className="parent-select" value={exceptionKind} onChange={(event) => setExceptionKind(event.target.value as 'cancelled' | 'replacement')}><option value="cancelled">Отменить урок</option><option value="replacement">Заменить урок</option></select>
        {exceptionKind === 'replacement' && <><label htmlFor="replacement-subject">Новый предмет</label><input id="replacement-subject" type="text" maxLength={80} value={replacementDraft.subject} onChange={(event) => setReplacementDraft((current) => ({ ...current, subject: event.target.value }))} placeholder="Например, Математика" required /><div className="parent-form-grid"><div><label htmlFor="replacement-start">Новое начало</label><input id="replacement-start" type="time" value={replacementDraft.startsAt} onChange={(event) => setReplacementDraft((current) => ({ ...current, startsAt: event.target.value }))} /></div><div><label htmlFor="replacement-end">Новое окончание</label><input id="replacement-end" type="time" value={replacementDraft.endsAt} onChange={(event) => setReplacementDraft((current) => ({ ...current, endsAt: event.target.value }))} /></div></div><label htmlFor="replacement-things">Что взять для замены</label><input id="replacement-things" type="text" value={replacementDraft.things} onChange={(event) => setReplacementDraft((current) => ({ ...current, things: event.target.value }))} placeholder="Можно оставить пустым" /></>}
        <button className="secondary-button" type="submit" disabled={savingCancellation || !cancellationLessonId}>{savingCancellation ? 'Сохраняем…' : exceptionKind === 'cancelled' ? 'Отменить урок на дату' : 'Сохранить замену'}</button>
      </form>}
      <div className="parent-lessons" aria-live="polite">
        <h3>Сохранённые уроки</h3>
        {lessons.length === 0 ? <p className="parent-empty">В этом учебном году уроков ещё нет.</p> : weekdays.map((day) => {
          const dayLessons = lessons.filter((lesson) => lesson.weekday === day.value)
          if (dayLessons.length === 0) return null
          return <section className="parent-day" key={day.value}><h4>{day.label}</h4>{dayLessons.map((lesson) => <article className="parent-lesson-row" key={lesson.id}><strong>{lesson.lesson_order}. {subjectTitle(lesson)}</strong><span>{localTime(lesson.starts_at)}–{localTime(lesson.ends_at)}</span>{lesson.things.length > 0 && <p>Взять: {lesson.things.join(', ')}</p>}<div className="parent-lesson-actions"><button type="button" onClick={() => beginEditing(lesson)} disabled={Boolean(editingLessonId) && editingLessonId !== lesson.id}>Изменить</button><button type="button" onClick={() => { setLessonPendingDeletion(lesson); setConfirmDiscard(false) }} disabled={deletingLesson}>Удалить</button></div>{editingLessonId === lesson.id && <form className="parent-inline-form" onSubmit={createLesson}><h3>Изменить урок</h3><LessonFields draft={lessonDraft} setDraft={setLessonDraft} /><button className="primary-button" type="submit" disabled={savingLesson}>{savingLesson ? 'Сохраняем…' : 'Сохранить изменения'}</button><button className="secondary-button" type="button" onClick={requestCancelEditing} disabled={savingLesson}>Отменить изменения</button>{confirmDiscard && <section className="parent-confirm" role="alert"><strong>Не сохранять изменения?</strong><p>Изменения этого урока будут потеряны.</p><div><button className="secondary-button" type="button" onClick={() => setConfirmDiscard(false)}>Продолжить</button><button className="danger-button" type="button" onClick={finishEditing}>Не сохранять</button></div></section>}</form>}{lessonPendingDeletion?.id === lesson.id && <section className="parent-confirm" role="alert"><strong>Удалить урок «{subjectTitle(lesson)}»?</strong><p>Будет удалён только этот повторяющийся урок. Остальные уроки и предмет останутся.</p><div><button className="secondary-button" type="button" onClick={() => setLessonPendingDeletion(null)} disabled={deletingLesson}>Отмена</button><button className="danger-button" type="button" onClick={deleteLesson} disabled={deletingLesson}>{deletingLesson ? 'Удаляем…' : 'Удалить урок'}</button></div></section>}</article>)}</section>
        })}
      </div>
    </>}
    {message && <p className="auth-message success" role="status">{message}</p>}
    {error && <p className="auth-message error" role="alert">{error}</p>}
  </section>
}
