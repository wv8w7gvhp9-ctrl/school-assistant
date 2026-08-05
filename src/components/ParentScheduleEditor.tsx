import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { parseThings, schoolYearDefaults, validateLessonDraft } from '../domain/schedule'
import { supabase } from '../lib/supabase'

type AcademicYear = { id: string; starts_on: string; ends_on: string }
type WeeklyLesson = {
  id: string
  weekday: number
  lesson_order: number
  starts_at: string
  ends_at: string
  things: string[]
  subject: { title: string } | { title: string }[] | null
}

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
  const [lessonDraft, setLessonDraft] = useState({ subject: '', weekday: '1', lessonOrder: '1', startsAt: '08:30', endsAt: '09:15', things: '' })

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
      .select('id, weekday, lesson_order, starts_at, ends_at, things, subject:subjects(title)')
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
      const { error: insertError } = await supabase.from('weekly_lessons').insert({
        family_id: familyId,
        academic_year_id: selectedYearId,
        subject_id: subjectId,
        weekday: Number(lessonDraft.weekday),
        lesson_order: Number(lessonDraft.lessonOrder),
        starts_at: lessonDraft.startsAt,
        ends_at: lessonDraft.endsAt,
        things: parseThings(lessonDraft.things),
      })
      if (insertError) {
        setError(insertError.code === '23505'
          ? 'В этот день уже есть урок с таким порядковым номером.'
          : 'Не удалось сохранить урок. Проверьте интернет и попробуйте ещё раз.')
        return
      }
      await loadLessons(selectedYearId)
      setLessonDraft((current) => ({ ...current, subject: '', lessonOrder: String(Number(current.lessonOrder) + 1), things: '' }))
      setMessage('Урок сохранён в недельном расписании.')
    } catch {
      setError('Не удалось сохранить урок. Проверьте интернет и попробуйте ещё раз.')
    } finally {
      setSavingLesson(false)
    }
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
      <select id="academic-year" className="parent-select" value={selectedYearId} onChange={(event) => { setSelectedYearId(event.target.value); setError(''); setMessage('') }}>
        {years.map((year) => <option value={year.id} key={year.id}>{year.starts_on} — {year.ends_on}</option>)}
      </select>
      {selectedYear && <form className="auth-form" onSubmit={createLesson}>
        <h3>Добавить урок</h3>
        <label htmlFor="lesson-subject">Предмет</label>
        <input id="lesson-subject" type="text" maxLength={80} value={lessonDraft.subject} onChange={(event) => setLessonDraft((current) => ({ ...current, subject: event.target.value }))} placeholder="Например, Математика" required />
        <div className="parent-form-grid"><div><label htmlFor="lesson-weekday">День</label><select id="lesson-weekday" className="parent-select" value={lessonDraft.weekday} onChange={(event) => setLessonDraft((current) => ({ ...current, weekday: event.target.value }))}>{weekdays.map((day) => <option value={day.value} key={day.value}>{day.label}</option>)}</select></div><div><label htmlFor="lesson-order">Номер урока</label><input id="lesson-order" type="number" min="1" inputMode="numeric" value={lessonDraft.lessonOrder} onChange={(event) => setLessonDraft((current) => ({ ...current, lessonOrder: event.target.value }))} required /></div></div>
        <div className="parent-form-grid"><div><label htmlFor="lesson-start">Начало</label><input id="lesson-start" type="time" value={lessonDraft.startsAt} onChange={(event) => setLessonDraft((current) => ({ ...current, startsAt: event.target.value }))} required /></div><div><label htmlFor="lesson-end">Окончание</label><input id="lesson-end" type="time" value={lessonDraft.endsAt} onChange={(event) => setLessonDraft((current) => ({ ...current, endsAt: event.target.value }))} required /></div></div>
        <label htmlFor="lesson-things">Что взять с собой</label>
        <input id="lesson-things" type="text" value={lessonDraft.things} onChange={(event) => setLessonDraft((current) => ({ ...current, things: event.target.value }))} placeholder="Тетрадь, учебник, ручка" />
        <p className="field-help">Перечислите вещи через запятую. Повторы будут объединены.</p>
        <button className="primary-button" type="submit" disabled={savingLesson}>{savingLesson ? 'Сохраняем…' : 'Добавить урок'}</button>
      </form>}
      <div className="parent-lessons" aria-live="polite">
        <h3>Сохранённые уроки</h3>
        {lessons.length === 0 ? <p className="parent-empty">В этом учебном году уроков ещё нет.</p> : weekdays.map((day) => {
          const dayLessons = lessons.filter((lesson) => lesson.weekday === day.value)
          if (dayLessons.length === 0) return null
          return <section className="parent-day" key={day.value}><h4>{day.label}</h4>{dayLessons.map((lesson) => <article className="parent-lesson-row" key={lesson.id}><strong>{lesson.lesson_order}. {subjectTitle(lesson)}</strong><span>{localTime(lesson.starts_at)}–{localTime(lesson.ends_at)}</span>{lesson.things.length > 0 && <p>Взять: {lesson.things.join(', ')}</p>}</article>)}</section>
        })}
      </div>
    </>}
    {message && <p className="auth-message success" role="status">{message}</p>}
    {error && <p className="auth-message error" role="alert">{error}</p>}
  </section>
}
