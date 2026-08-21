import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import {
  formatNonSchoolPeriod,
  groupNonSchoolDays,
  nonSchoolReasonLabels,
  parseThings,
  schoolYearDefaults,
  validateLessonDraft,
  validateLessonExceptionDate,
  validateNonSchoolPeriod,
  validateOptionalTimeRange,
  type NonSchoolDay,
  type NonSchoolPeriod,
  type NonSchoolReason,
} from '../domain/schedule'
import {
  academicYearLabel,
  formatCalendarPeriod,
  isCalendarProposal,
  type SchoolCalendarProposal,
} from '../domain/schoolCalendar'
import { offlineKey, readOfflineSnapshot, saveOfflineSnapshot } from '../lib/offlineCache'
import { supabase } from '../lib/supabase'
import { OfflineDataNote, useOnlineStatus } from './NetworkStatus'

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

type LessonExceptionKind = 'cancelled' | 'replacement' | 'extra'
type ExceptionLessonDraft = { subject: string; lessonOrder: string; startsAt: string; endsAt: string; things: string }
type ParentScheduleSnapshot = {
  years: AcademicYear[]
  selectedYearId: string
  lessons: WeeklyLesson[]
  nonSchoolDays: NonSchoolDay[]
  calendarProposals: SchoolCalendarProposal[]
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

function currentSamaraIsoDate() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Samara', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const value = (kind: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === kind)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
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

export function ParentScheduleEditor({ parentUserId, familyId }: { parentUserId: string; familyId: string }) {
  const online = useOnlineStatus()
  const cacheKey = offlineKey.parentSchedule(parentUserId, familyId)
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
  const [exceptionKind, setExceptionKind] = useState<LessonExceptionKind>('cancelled')
  const [exceptionDraft, setExceptionDraft] = useState<ExceptionLessonDraft>({ subject: '', lessonOrder: '1', startsAt: '', endsAt: '', things: '' })
  const [nonSchoolDays, setNonSchoolDays] = useState<NonSchoolDay[]>([])
  const [nonSchoolDraft, setNonSchoolDraft] = useState<{ reason: NonSchoolReason; startsOn: string; endsOn: string }>({ reason: 'vacation', startsOn: '', endsOn: '' })
  const [savingNonSchoolPeriod, setSavingNonSchoolPeriod] = useState(false)
  const [periodPendingDeletion, setPeriodPendingDeletion] = useState<NonSchoolPeriod | null>(null)
  const [deletingNonSchoolPeriod, setDeletingNonSchoolPeriod] = useState(false)
  const [calendarProposals, setCalendarProposals] = useState<SchoolCalendarProposal[]>([])
  const [reviewingProposalId, setReviewingProposalId] = useState<string | null>(null)
  const [proposalPendingRejection, setProposalPendingRejection] = useState<string | null>(null)
  const [cachedAt, setCachedAt] = useState<string | null>(null)
  const [cloudSnapshotReady, setCloudSnapshotReady] = useState(false)

  const applyOfflineSnapshot = (snapshot: ParentScheduleSnapshot) => {
    setYears(snapshot.years)
    setSelectedYearId(snapshot.selectedYearId)
    setLessons(snapshot.lessons)
    setNonSchoolDays(snapshot.nonSchoolDays)
    setCalendarProposals(snapshot.calendarProposals)
  }

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
    setSelectedYearId((current) => nextYears.some((year) => year.id === current) ? current : nextYears[0]?.id || '')
    return nextYears
  }

  const loadLessons = async (yearId: string) => {
    const client = supabase
    if (!client || !yearId) {
      setLessons([])
      return [] as WeeklyLesson[]
    }
    const { data, error: requestError } = await client
      .from('weekly_lessons')
      .select('id, subject_id, weekday, lesson_order, starts_at, ends_at, things, subject:subjects(title)')
      .eq('family_id', familyId)
      .eq('academic_year_id', yearId)
      .order('weekday')
      .order('lesson_order')

    if (requestError) throw requestError
    const nextLessons = (data ?? []) as unknown as WeeklyLesson[]
    setLessons(nextLessons)
    return nextLessons
  }

  const loadNonSchoolDays = async (year: AcademicYear) => {
    const client = supabase
    if (!client) return
    const { data, error: requestError } = await client
      .from('non_school_days')
      .select('day, reason')
      .eq('family_id', familyId)
      .gte('day', year.starts_on)
      .lte('day', year.ends_on)
      .order('day')
    if (requestError) throw requestError
    const nextDays = (data ?? []) as NonSchoolDay[]
    setNonSchoolDays(nextDays)
    return nextDays
  }

  const loadCalendarProposals = async (yearId: string) => {
    const client = supabase
    if (!client || !yearId) {
      setCalendarProposals([])
      return [] as SchoolCalendarProposal[]
    }
    const { data, error: requestError } = await client.rpc('get_my_school_calendar_proposals', {
      input_academic_year_id: yearId,
    })
    if (requestError) throw requestError
    const proposals = (data ?? []).filter(isCalendarProposal)
    if (proposals.length !== (data ?? []).length) throw new Error('Unexpected calendar proposal response')
    setCalendarProposals(proposals)
    return proposals
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setCloudSnapshotReady(false)
    const restore = async () => {
      const cached = await readOfflineSnapshot<ParentScheduleSnapshot>(cacheKey)
      if (!active) return
      if (cached) {
        applyOfflineSnapshot(cached.data)
        setCachedAt(cached.savedAt)
        setError('')
      } else {
        setError(online ? 'Не удалось загрузить расписание. Проверьте интернет и попробуйте ещё раз.' : 'Нет интернета, а расписание ещё не сохранено на этом устройстве.')
      }
      setLoading(false)
    }
    if (!online) void restore()
    else void loadYears().then(() => {
      if (active) setCachedAt(null)
    }).catch(() => void restore()).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [familyId, cacheKey, online])

  const selectedYear = years.find((year) => year.id === selectedYearId)

  useEffect(() => {
    if (!selectedYear) return
    if (!online) return
    let active = true
    setLoading(true)
    setCloudSnapshotReady(false)
    void Promise.all([loadLessons(selectedYear.id), loadNonSchoolDays(selectedYear), loadCalendarProposals(selectedYear.id)]).then(() => {
      if (!active) return
      setCachedAt(null)
      setCloudSnapshotReady(true)
      setError('')
    }).catch(async () => {
      const cached = await readOfflineSnapshot<ParentScheduleSnapshot>(cacheKey)
      if (!active) return
      if (cached?.data.selectedYearId === selectedYear.id) {
        applyOfflineSnapshot(cached.data)
        setCachedAt(cached.savedAt)
        setError('')
      } else setError('Не удалось загрузить уроки и неучебные дни. Проверьте интернет и попробуйте ещё раз.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [selectedYearId, online, cacheKey, familyId])

  useEffect(() => {
    if (!online || !cloudSnapshotReady || loading || !selectedYear) return
    void saveOfflineSnapshot(cacheKey, { years, selectedYearId, lessons, nonSchoolDays, calendarProposals } satisfies ParentScheduleSnapshot)
  }, [cacheKey, calendarProposals, cloudSnapshotReady, lessons, loading, nonSchoolDays, online, selectedYear, selectedYearId, years])

  useEffect(() => {
    if (!selectedYear) return
    const today = currentSamaraIsoDate()
    const initialDay = today >= selectedYear.starts_on && today <= selectedYear.ends_on ? today : selectedYear.starts_on
    setNonSchoolDraft({ reason: 'vacation', startsOn: initialDay, endsOn: initialDay })
    setCancellationDate(initialDay)
    setCancellationLessonId('')
    setPeriodPendingDeletion(null)
    setProposalPendingRejection(null)
  }, [selectedYearId])

  useEffect(() => {
    if (!loading && selectedYear && lessons.length === 0) setExceptionKind('extra')
  }, [lessons.length, loading, selectedYear])

  async function createYear(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    if (!online) {
      setError('Без интернета учебный год можно только просматривать.')
      return
    }
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
    if (!online) {
      setError('Без интернета расписание можно только просматривать.')
      return
    }
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
    if (!online) {
      setError('Без интернета расписание можно только просматривать.')
      return
    }
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
    if (!supabase || !selectedYear || savingCancellation) return
    if (!online) {
      setError('Не удалось сохранить без интернета. Подключитесь к сети и попробуйте ещё раз.')
      return
    }
    const dateError = validateLessonExceptionDate(cancellationDate, selectedYear)
    if (dateError) { setError(dateError); return }
    if (nonSchoolDays.some((day) => day.day === cancellationDate)) {
      setError('На эту дату сохранён неучебный день. Сначала измените календарь каникул и выходных.')
      return
    }
    if (exceptionKind !== 'extra' && !cancellationLessonId) { setError('Выберите урок.'); return }
    if (exceptionKind === 'extra') {
      const weekday = new Date(`${cancellationDate}T00:00:00Z`).getUTCDay()
      if (lessons.some((lesson) => lesson.weekday === weekday && lesson.lesson_order === Number(exceptionDraft.lessonOrder))) {
        setError('В этот день уже есть обычный урок с таким номером. Укажите другой номер.')
        return
      }
    }
    const timeError = exceptionKind === 'replacement'
      ? validateOptionalTimeRange(exceptionDraft.startsAt, exceptionDraft.endsAt)
      : exceptionKind === 'extra'
        ? validateLessonDraft(exceptionDraft)
        : null
    if (timeError) { setError(timeError); return }
    if (exceptionKind === 'replacement' && !exceptionDraft.subject.trim()) { setError('Введите предмет для замены.'); return }
    setSavingCancellation(true)
    setError('')
    setMessage('')
    let subjectId: string | null = null
    try {
      subjectId = exceptionKind === 'cancelled' ? null : await findOrCreateSubject(exceptionDraft.subject.trim())
    } catch {
      setSavingCancellation(false)
      setError('Не удалось подготовить предмет. Проверьте интернет и попробуйте ещё раз.')
      return
    }
    const { error: cancellationError } = await supabase.from('lesson_exceptions').insert({
      family_id: familyId,
      day: cancellationDate,
      weekly_lesson_id: exceptionKind === 'extra' ? null : cancellationLessonId,
      kind: exceptionKind,
      subject_id: subjectId,
      lesson_order: exceptionKind === 'extra' ? Number(exceptionDraft.lessonOrder) : null,
      starts_at: exceptionDraft.startsAt || null,
      ends_at: exceptionDraft.endsAt || null,
      things: exceptionKind !== 'cancelled' && exceptionDraft.things.trim() ? parseThings(exceptionDraft.things) : null,
    })
    setSavingCancellation(false)
    if (cancellationError) {
      setError(cancellationError.code === '23505'
        ? exceptionKind === 'extra'
          ? 'На эту дату уже есть дополнительный урок с таким номером.'
          : 'Для этого урока на эту дату изменение уже сохранено.'
        : 'Не удалось сохранить изменение. Проверьте интернет и попробуйте ещё раз.')
      return
    }
    setExceptionDraft({ subject: '', lessonOrder: String(Number(exceptionDraft.lessonOrder) + 1 || 1), startsAt: '', endsAt: '', things: '' })
    setMessage(exceptionKind === 'cancelled'
      ? 'Отмена урока на выбранную дату сохранена.'
      : exceptionKind === 'replacement'
        ? 'Замена урока на выбранную дату сохранена.'
        : 'Дополнительный урок на выбранную дату сохранён.')
  }

  async function saveNonSchoolPeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !selectedYear || savingNonSchoolPeriod) return
    const validationError = validateNonSchoolPeriod(nonSchoolDraft, selectedYear)
    if (validationError) {
      setError(validationError)
      return
    }
    if (!online) {
      setError('Не удалось сохранить без интернета. Подключитесь к сети и попробуйте ещё раз.')
      return
    }
    setSavingNonSchoolPeriod(true)
    setError('')
    setMessage('')
    const { error: saveError } = await supabase.rpc('save_non_school_period', {
      input_academic_year_id: selectedYear.id,
      input_starts_on: nonSchoolDraft.startsOn,
      input_ends_on: nonSchoolDraft.endsOn,
      input_reason: nonSchoolDraft.reason,
    })
    setSavingNonSchoolPeriod(false)
    if (saveError) {
      setError(saveError.code === '23505'
        ? 'Часть этого периода уже отмечена другим типом. Сначала удалите прежнюю запись.'
        : saveError.code === '22023'
          ? 'Проверьте даты: период должен находиться внутри учебного года.'
          : 'Не удалось сохранить неучебные дни. Проверьте интернет и попробуйте ещё раз.')
      return
    }
    try {
      await loadNonSchoolDays(selectedYear)
      setMessage('Запись добавлена в календарь.')
    } catch {
      setError('Запись сохранена, но список не обновился. Проверьте интернет и откройте страницу снова.')
    }
  }

  async function deleteNonSchoolPeriod() {
    if (!supabase || !selectedYear || !periodPendingDeletion || deletingNonSchoolPeriod) return
    if (!online) {
      setError('Не удалось удалить без интернета. Подключитесь к сети и попробуйте ещё раз.')
      return
    }
    setDeletingNonSchoolPeriod(true)
    setError('')
    setMessage('')
    const { data, error: deleteError } = await supabase.rpc('delete_non_school_period', {
      input_academic_year_id: selectedYear.id,
      input_starts_on: periodPendingDeletion.startsOn,
      input_ends_on: periodPendingDeletion.endsOn,
      input_reason: periodPendingDeletion.reason,
    })
    setDeletingNonSchoolPeriod(false)
    if (deleteError) {
      setError('Не удалось удалить запись. Проверьте интернет и попробуйте ещё раз.')
      return
    }
    const deletedDays = Number((data as { deleted_days: number }[] | null)?.[0]?.deleted_days ?? 0)
    setPeriodPendingDeletion(null)
    try {
      await loadNonSchoolDays(selectedYear)
      setMessage(deletedDays > 0 ? 'Неучебные дни удалены из календаря.' : 'Эта запись уже была удалена.')
    } catch {
      setError('Запись удалена, но список не обновился. Проверьте интернет и откройте страницу снова.')
    }
  }

  async function approveCalendarProposal(proposal: SchoolCalendarProposal) {
    if (!supabase || !selectedYear || reviewingProposalId) return
    if (!online) {
      setError('Не удалось подтвердить календарь без интернета. Подключитесь к сети и попробуйте ещё раз.')
      return
    }
    setReviewingProposalId(proposal.id)
    setError('')
    setMessage('')
    const { data, error: reviewError } = await supabase.rpc('approve_my_school_calendar_proposal', {
      input_proposal_id: proposal.id,
    })
    setReviewingProposalId(null)
    if (reviewError) {
      setError(reviewError.code === '22023'
        ? 'Это предложение уже было рассмотрено. Обновите страницу.'
        : 'Не удалось подтвердить календарь. Проверьте интернет и попробуйте ещё раз.')
      return
    }
    const result = (data as { added_days: number; preserved_days: number }[] | null)?.[0]
    try {
      await Promise.all([loadNonSchoolDays(selectedYear), loadCalendarProposals(selectedYear.id)])
      const preserved = Number(result?.preserved_days ?? 0)
      setMessage(preserved > 0
        ? `Календарь подтверждён. Добавлено дней: ${Number(result?.added_days ?? 0)}. Ручные записи сохранены: ${preserved}.`
        : `Календарь подтверждён. Добавлено дней: ${Number(result?.added_days ?? 0)}.`)
    } catch {
      setError('Календарь подтверждён, но список не обновился. Откройте страницу снова.')
    }
  }

  async function rejectCalendarProposal(proposal: SchoolCalendarProposal) {
    if (!supabase || reviewingProposalId) return
    if (!online) {
      setError('Не удалось отклонить предложение без интернета. Подключитесь к сети и попробуйте ещё раз.')
      return
    }
    setReviewingProposalId(proposal.id)
    setError('')
    setMessage('')
    const { error: reviewError } = await supabase.rpc('reject_my_school_calendar_proposal', {
      input_proposal_id: proposal.id,
    })
    setReviewingProposalId(null)
    if (reviewError) {
      setError('Не удалось отклонить предложение. Проверьте интернет и попробуйте ещё раз.')
      return
    }
    setProposalPendingRejection(null)
    await loadCalendarProposals(selectedYearId)
    setMessage('Предложение отклонено. Сохранённые даты не изменились.')
  }

  const nonSchoolPeriods = groupNonSchoolDays(nonSchoolDays)
  const visibleCalendarProposal = calendarProposals.find((proposal) => proposal.status === 'pending')
    ?? calendarProposals.find((proposal) => proposal.status === 'approved')

  return <section className="parent-schedule" aria-labelledby="parent-schedule-title">
    <div className="parent-section-heading"><div><p className="eyebrow">Для родителя</p><h2 id="parent-schedule-title">Недельное расписание</h2></div></div>
    <p>Сначала выберите учебный год, затем добавьте уроки с понедельника по пятницу.</p>
    {cachedAt && <OfflineDataNote savedAt={cachedAt} />}
    {!online && years.length > 0 && <p className="auth-message warning" role="status">Сохранённое расписание доступно только для просмотра. Изменения вернутся после подключения к интернету.</p>}
    {loading && <p className="auth-loading" role="status">Загружаем расписание…</p>}
    {!loading && online && years.length === 0 && <form className="auth-form" onSubmit={createYear}>
      <label htmlFor="year-start">Начало учебного года</label>
      <input id="year-start" type="date" value={yearDraft.startsOn} onChange={(event) => setYearDraft((current) => ({ ...current, startsOn: event.target.value }))} required />
      <label htmlFor="year-end">Окончание учебного года</label>
      <input id="year-end" type="date" value={yearDraft.endsOn} onChange={(event) => setYearDraft((current) => ({ ...current, endsOn: event.target.value }))} required />
      <button className="primary-button" type="submit" disabled={savingYear}>{savingYear ? 'Сохраняем…' : 'Сохранить учебный год'}</button>
    </form>}
    {!loading && years.length > 0 && <>
      <label className="parent-select-label" htmlFor="academic-year">Учебный год</label>
      <select id="academic-year" className="parent-select" value={selectedYearId} disabled={!online || Boolean(editingLessonId)} onChange={(event) => { setCloudSnapshotReady(false); setSelectedYearId(event.target.value); setError(''); setMessage('') }}>
        {years.map((year) => <option value={year.id} key={year.id}>{year.starts_on} — {year.ends_on}</option>)}
      </select>
      {online && selectedYear && !editingLessonId && <form className="auth-form" onSubmit={createLesson}>
        <h3>Добавить урок</h3>
        <LessonFields draft={lessonDraft} setDraft={setLessonDraft} />
        <button className="primary-button" type="submit" disabled={savingLesson}>{savingLesson ? 'Сохраняем…' : 'Добавить урок'}</button>
      </form>}
      {online && selectedYear && <form className="parent-exception-form" onSubmit={saveLessonException}>
        <h3>Изменить урок на дату</h3>
        <p>Недельное расписание не изменится: это изменение подействует только в выбранный день.</p>
        {!online && <p className="auth-message warning" role="status">Сейчас нет интернета. Сохранение будет доступно после подключения.</p>}
        <label htmlFor="cancellation-date">Дата</label>
        <input id="cancellation-date" type="date" min={selectedYear.starts_on} max={selectedYear.ends_on} value={cancellationDate} onChange={(event) => setCancellationDate(event.target.value)} required />
        <label htmlFor="exception-kind">Действие</label>
        <select id="exception-kind" className="parent-select" value={exceptionKind} onChange={(event) => { setExceptionKind(event.target.value as LessonExceptionKind); setError(''); setMessage('') }}><option value="cancelled" disabled={lessons.length === 0}>Отменить урок</option><option value="replacement" disabled={lessons.length === 0}>Заменить урок</option><option value="extra">Добавить дополнительный урок</option></select>
        {exceptionKind !== 'extra' && <><label htmlFor="cancellation-lesson">Урок</label><select id="cancellation-lesson" className="parent-select" value={cancellationLessonId} onChange={(event) => setCancellationLessonId(event.target.value)} required><option value="" disabled>Выберите урок</option>{lessons.map((lesson) => <option value={lesson.id} key={lesson.id}>{weekdays.find((day) => day.value === lesson.weekday)?.label}: {lesson.lesson_order}. {subjectTitle(lesson)} · {localTime(lesson.starts_at)}</option>)}</select></>}
        {exceptionKind !== 'cancelled' && <>
          <label htmlFor="exception-subject">{exceptionKind === 'replacement' ? 'Новый предмет' : 'Предмет'}</label>
          <input id="exception-subject" type="text" maxLength={80} value={exceptionDraft.subject} onChange={(event) => setExceptionDraft((current) => ({ ...current, subject: event.target.value }))} placeholder="Например, Математика" required />
          {exceptionKind === 'extra' && <><label htmlFor="exception-order">Номер урока</label><input id="exception-order" type="number" min="1" inputMode="numeric" value={exceptionDraft.lessonOrder} onChange={(event) => setExceptionDraft((current) => ({ ...current, lessonOrder: event.target.value }))} required /></>}
          <div className="parent-form-grid"><div><label htmlFor="exception-start">{exceptionKind === 'replacement' ? 'Новое начало' : 'Начало'}</label><input id="exception-start" type="time" value={exceptionDraft.startsAt} onChange={(event) => setExceptionDraft((current) => ({ ...current, startsAt: event.target.value }))} required={exceptionKind === 'extra'} /></div><div><label htmlFor="exception-end">{exceptionKind === 'replacement' ? 'Новое окончание' : 'Окончание'}</label><input id="exception-end" type="time" value={exceptionDraft.endsAt} onChange={(event) => setExceptionDraft((current) => ({ ...current, endsAt: event.target.value }))} required={exceptionKind === 'extra'} /></div></div>
          <label htmlFor="exception-things">{exceptionKind === 'replacement' ? 'Что взять для замены' : 'Что взять с собой'}</label><input id="exception-things" type="text" value={exceptionDraft.things} onChange={(event) => setExceptionDraft((current) => ({ ...current, things: event.target.value }))} placeholder="Тетрадь, учебник, ручка" />
        </>}
        {lessons.length === 0 && exceptionKind !== 'extra' && <p className="auth-message warning" role="status">Сначала добавьте урок в недельное расписание или выберите дополнительный урок.</p>}
        <button className="secondary-button" type="submit" disabled={!online || savingCancellation || (exceptionKind !== 'extra' && !cancellationLessonId)}>{savingCancellation ? 'Сохраняем…' : exceptionKind === 'cancelled' ? 'Отменить урок на дату' : exceptionKind === 'replacement' ? 'Сохранить замену' : 'Добавить урок на дату'}</button>
      </form>}
      {selectedYear && <section className="parent-calendar-section" aria-labelledby="non-school-title">
        <section className="calendar-proposal-panel" aria-labelledby="calendar-proposal-title">
          <div>
            <p className="eyebrow">Официальные рекомендации</p>
            <h3 id="calendar-proposal-title">Календарь на {academicYearLabel(selectedYear.starts_on)} год</h3>
          </div>
          {!visibleCalendarProposal && <p className="parent-empty">Официальное предложение пока не найдено. Система проверит источник снова по расписанию.</p>}
          {visibleCalendarProposal && <>
            <p className={`auth-message ${visibleCalendarProposal.status === 'approved' ? 'success' : 'warning'}`} role="status">
              {visibleCalendarProposal.status === 'approved'
                ? 'Календарь подтверждён родителем и уже действует.'
                : 'Проверьте даты. До подтверждения детское расписание не изменится.'}
            </p>
            <div className="calendar-source">
              <strong>{visibleCalendarProposal.document_title}</strong>
              <p>Письмо № {visibleCalendarProposal.document_number} от {formatCalendarPeriod({ label: '', reason: 'holiday', starts_on: visibleCalendarProposal.published_on, ends_on: visibleCalendarProposal.published_on })}</p>
              <div><a href={visibleCalendarProposal.source_url} target="_blank" rel="noreferrer">Открыть в КонсультантПлюс</a><a href={visibleCalendarProposal.official_index_url} target="_blank" rel="noreferrer">Официальная публикация</a></div>
            </div>
            <ul className="calendar-period-list">
              {visibleCalendarProposal.periods.map((period) => <li key={`${period.label}-${period.starts_on}`}><strong>{period.label}</strong><span>{formatCalendarPeriod(period)}</span></li>)}
            </ul>
            <p className="field-help">Общие даты для четвертной системы. Ручные записи не будут перезаписаны. Дополнительные каникулы первого класса не добавляются без подтверждённых данных о классе.</p>
            {visibleCalendarProposal.status === 'pending' && <div className="calendar-proposal-actions">
              <button className="primary-button" type="button" onClick={() => void approveCalendarProposal(visibleCalendarProposal)} disabled={!online || Boolean(reviewingProposalId)}>{reviewingProposalId === visibleCalendarProposal.id ? 'Сохраняем…' : 'Подтвердить и добавить'}</button>
              <button className="secondary-button" type="button" onClick={() => setProposalPendingRejection(visibleCalendarProposal.id)} disabled={!online || Boolean(reviewingProposalId)}>Не использовать</button>
            </div>}
            {proposalPendingRejection === visibleCalendarProposal.id && <section className="parent-confirm" role="alert"><strong>Не использовать эти рекомендации?</strong><p>Предложение исчезнет, но уже сохранённые вручную даты останутся.</p><div><button className="secondary-button" type="button" onClick={() => setProposalPendingRejection(null)} disabled={Boolean(reviewingProposalId)}>Отмена</button><button className="danger-button" type="button" onClick={() => void rejectCalendarProposal(visibleCalendarProposal)} disabled={Boolean(reviewingProposalId)}>{reviewingProposalId ? 'Сохраняем…' : 'Не использовать'}</button></div></section>}
          </>}
        </section>
        {online && <form className="parent-exception-form" onSubmit={saveNonSchoolPeriod}>
          <h3 id="non-school-title">Каникулы и неучебные дни</h3>
          <p>В эти даты уроки не показываются, а рюкзак будет собран на ближайший фактический учебный день.</p>
          {!online && <p className="auth-message warning" role="status">Сейчас нет интернета. Сохранение и удаление будут доступны после подключения.</p>}
          <label htmlFor="non-school-reason">Тип</label>
          <select id="non-school-reason" className="parent-select" value={nonSchoolDraft.reason} onChange={(event) => setNonSchoolDraft((current) => ({ ...current, reason: event.target.value as NonSchoolReason }))}>
            <option value="vacation">Каникулы</option>
            <option value="holiday">Праздник</option>
            <option value="weekend_override">Выходной</option>
          </select>
          <div className="parent-form-grid"><div><label htmlFor="non-school-start">Начало</label><input id="non-school-start" type="date" min={selectedYear.starts_on} max={selectedYear.ends_on} value={nonSchoolDraft.startsOn} onChange={(event) => setNonSchoolDraft((current) => ({ ...current, startsOn: event.target.value, endsOn: current.endsOn < event.target.value ? event.target.value : current.endsOn }))} required /></div><div><label htmlFor="non-school-end">Окончание</label><input id="non-school-end" type="date" min={nonSchoolDraft.startsOn || selectedYear.starts_on} max={selectedYear.ends_on} value={nonSchoolDraft.endsOn} onChange={(event) => setNonSchoolDraft((current) => ({ ...current, endsOn: event.target.value }))} required /></div></div>
          <button className="secondary-button" type="submit" disabled={savingNonSchoolPeriod || !online}>{savingNonSchoolPeriod ? 'Сохраняем…' : 'Добавить в календарь'}</button>
        </form>}
        <div className="parent-non-school-list" aria-live="polite">
          <h3>Сохранённые даты</h3>
          {nonSchoolPeriods.length === 0 ? <p className="parent-empty">Каникулы и неучебные дни ещё не добавлены.</p> : nonSchoolPeriods.map((period) => <article className="parent-non-school-row" key={`${period.reason}-${period.startsOn}-${period.endsOn}`}>
            <div><strong>{nonSchoolReasonLabels[period.reason]}</strong><p>{formatNonSchoolPeriod(period)}</p></div>
            <button type="button" onClick={() => setPeriodPendingDeletion(period)} disabled={deletingNonSchoolPeriod || !online}>Удалить</button>
            {periodPendingDeletion?.reason === period.reason && periodPendingDeletion.startsOn === period.startsOn && periodPendingDeletion.endsOn === period.endsOn && <section className="parent-confirm" role="alert"><strong>Удалить запись «{nonSchoolReasonLabels[period.reason].toLowerCase()}»?</strong><p>В эти даты снова будет действовать обычное недельное расписание.</p><div><button className="secondary-button" type="button" onClick={() => setPeriodPendingDeletion(null)} disabled={deletingNonSchoolPeriod}>Отмена</button><button className="danger-button" type="button" onClick={() => void deleteNonSchoolPeriod()} disabled={deletingNonSchoolPeriod}>{deletingNonSchoolPeriod ? 'Удаляем…' : 'Удалить'}</button></div></section>}
          </article>)}
        </div>
      </section>}
      <div className="parent-lessons" aria-live="polite">
        <h3>Сохранённые уроки</h3>
        {lessons.length === 0 ? <p className="parent-empty">В этом учебном году уроков ещё нет.</p> : weekdays.map((day) => {
          const dayLessons = lessons.filter((lesson) => lesson.weekday === day.value)
          if (dayLessons.length === 0) return null
          return <section className="parent-day" key={day.value}><h4>{day.label}</h4>{dayLessons.map((lesson) => <article className="parent-lesson-row" key={lesson.id}><strong>{lesson.lesson_order}. {subjectTitle(lesson)}</strong><span>{localTime(lesson.starts_at)}–{localTime(lesson.ends_at)}</span>{lesson.things.length > 0 && <p>Взять: {lesson.things.join(', ')}</p>}<div className="parent-lesson-actions"><button type="button" onClick={() => beginEditing(lesson)} disabled={!online || (Boolean(editingLessonId) && editingLessonId !== lesson.id)}>Изменить</button><button type="button" onClick={() => { setLessonPendingDeletion(lesson); setConfirmDiscard(false) }} disabled={!online || deletingLesson}>Удалить</button></div>{online && editingLessonId === lesson.id && <form className="parent-inline-form" onSubmit={createLesson}><h3>Изменить урок</h3><LessonFields draft={lessonDraft} setDraft={setLessonDraft} /><button className="primary-button" type="submit" disabled={savingLesson}>{savingLesson ? 'Сохраняем…' : 'Сохранить изменения'}</button><button className="secondary-button" type="button" onClick={requestCancelEditing} disabled={savingLesson}>Отменить изменения</button>{confirmDiscard && <section className="parent-confirm" role="alert"><strong>Не сохранять изменения?</strong><p>Изменения этого урока будут потеряны.</p><div><button className="secondary-button" type="button" onClick={() => setConfirmDiscard(false)}>Продолжить</button><button className="danger-button" type="button" onClick={finishEditing}>Не сохранять</button></div></section>}</form>}{online && lessonPendingDeletion?.id === lesson.id && <section className="parent-confirm" role="alert"><strong>Удалить урок «{subjectTitle(lesson)}»?</strong><p>Будет удалён только этот повторяющийся урок. Остальные уроки и предмет останутся.</p><div><button className="secondary-button" type="button" onClick={() => setLessonPendingDeletion(null)} disabled={deletingLesson}>Отмена</button><button className="danger-button" type="button" onClick={deleteLesson} disabled={deletingLesson}>{deletingLesson ? 'Удаляем…' : 'Удалить урок'}</button></div></section>}</article>)}</section>
        })}
      </div>
    </>}
    {message && <p className="auth-message success" role="status">{message}</p>}
    {error && <p className="auth-message error" role="alert">{error}</p>}
  </section>
}
