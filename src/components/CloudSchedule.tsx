import { useEffect, useMemo, useState } from 'react'
import { canShiftScheduleWeek, initialScheduleDate, isSameScheduleWeek, isoWeekday, lessonStatusLabel, scheduleDateLabel, scheduleWeekDates, scheduleWeekLabel, schoolDayMessage, shiftScheduleWeek, timeRange, type AcademicYearBounds, type CloudLesson, type SchoolDayStatus } from '../domain/childSchedule'
import { supabase } from '../lib/supabase'
import { loadWithOfflineFallback, offlineKey } from '../lib/offlineCache'
import { useChildSession } from './ChildSession'
import { OfflineDataNote, useOnlineStatus } from './NetworkStatus'

function samaraNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Samara', weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
  }).formatToParts(new Date())
  const numericParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Samara', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const value = (kind: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === kind)?.value ?? ''
  const dayNames: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  const numericValue = (kind: Intl.DateTimeFormatPartTypes) => numericParts.find((part) => part.type === kind)?.value ?? ''
  return { weekday: dayNames[value('weekday')] ?? 1, label: `${value('day')} ${value('month')} ${value('year')}`, iso: `${numericValue('year')}-${numericValue('month')}-${numericValue('day')}` }
}

export function CloudSchedule() {
  const profile = useChildSession()
  const online = useOnlineStatus()
  const today = useMemo(samaraNow, [])
  const [academicYear, setAcademicYear] = useState<AcademicYearBounds | null>(null)
  const [yearState, setYearState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selectedDate, setSelectedDate] = useState(today.iso)
  const [lessons, setLessons] = useState<CloudLesson[]>([])
  const [schoolDayStatus, setSchoolDayStatus] = useState<SchoolDayStatus | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [cachedAt, setCachedAt] = useState<string | null>(null)

  useEffect(() => {
    const client = supabase
    if (!client || !profile) return
    let active = true
    setYearState('loading')
    void loadWithOfflineFallback<AcademicYearBounds[]>(
      offlineKey.scheduleAcademicYear(profile.childId),
      () => client.rpc('get_my_schedule_academic_year'),
      online,
    ).then((result) => {
      if (!active) return
      const nextAcademicYear = result.data?.[0] ?? null
      if (result.source === 'none' || !nextAcademicYear) {
        setAcademicYear(null)
        setYearState('error')
        return
      }
      setAcademicYear(nextAcademicYear)
      setSelectedDate((currentDate) => currentDate >= nextAcademicYear.starts_on && currentDate <= nextAcademicYear.ends_on
        ? currentDate
        : initialScheduleDate(today.iso, nextAcademicYear))
      setCachedAt(result.source === 'cache' ? result.savedAt : null)
      setYearState('ready')
    })
    return () => { active = false }
  }, [online, profile, today.iso])

  useEffect(() => {
    const client = supabase
    if (!client || !profile || !academicYear) return
    let active = true
    setState('loading')
    void Promise.all([
      loadWithOfflineFallback<CloudLesson[]>(offlineKey.schedule(profile.childId, selectedDate), () => client.rpc('get_my_schedule_for_date', { input_day: selectedDate }), online),
      loadWithOfflineFallback<SchoolDayStatus[]>(offlineKey.schoolDayStatus(profile.childId, selectedDate), () => client.rpc('get_my_school_day_status', { input_day: selectedDate }), online),
    ]).then(([result, statusResult]) => {
      if (!active) return
      if (result.source === 'none') {
        setState('error')
        return
      }
      setLessons(result.data ?? [])
      setSchoolDayStatus(statusResult.source === 'none' ? null : statusResult.data?.[0] ?? null)
      if (statusResult.source === 'none') console.warn('Не удалось загрузить статус учебного дня', statusResult.error)
      setCachedAt(result.source === 'cache' ? result.savedAt : statusResult.source === 'cache' ? statusResult.savedAt : null)
      setState('ready')
    })
    return () => { active = false }
  }, [academicYear, online, profile, selectedDate])

  const selectedDay = isoWeekday(selectedDate)
  const dayLessons = lessons.filter((lesson) => lesson.weekday === selectedDay)
  const isToday = selectedDate === today.iso
  const nonSchoolMessage = schoolDayMessage(schoolDayStatus?.reason)
  const initialDate = academicYear ? initialScheduleDate(today.iso, academicYear) : today.iso
  const weekDays = academicYear ? scheduleWeekDates(selectedDate, academicYear) : []
  const canGoBack = academicYear ? canShiftScheduleWeek(selectedDate, -1, academicYear) : false
  const canGoForward = academicYear ? canShiftScheduleWeek(selectedDate, 1, academicYear) : false

  return <section className="screen"><div className="screen-heading"><div><p className="eyebrow">Моя неделя</p><h1>Расписание</h1></div></div>
    {yearState === 'loading' && <p className="child-cloud-state" role="status">Находим твой учебный год…</p>}
    {yearState === 'error' && <p className="auth-message error" role="alert">{online ? 'Учебный год пока не настроен. Попроси родителя проверить календарь.' : 'Границы учебного года ещё не сохранены на этом устройстве.'}</p>}
    {yearState === 'ready' && academicYear && <>
      <div className="schedule-week-nav" aria-label="Выберите учебную неделю">
        <button type="button" onClick={() => setSelectedDate(shiftScheduleWeek(selectedDate, -1, academicYear))} disabled={!canGoBack} aria-label="Предыдущая учебная неделя">‹</button>
        <div aria-live="polite"><span>Учебная неделя</span><strong>{scheduleWeekLabel(selectedDate, academicYear)}</strong></div>
        <button type="button" onClick={() => setSelectedDate(shiftScheduleWeek(selectedDate, 1, academicYear))} disabled={!canGoForward} aria-label="Следующая учебная неделя">›</button>
      </div>
      {!isSameScheduleWeek(selectedDate, initialDate) && <button type="button" className="text-button schedule-week-reset" onClick={() => setSelectedDate(initialDate)}>{today.iso < academicYear.starts_on ? 'К началу учебного года' : today.iso > academicYear.ends_on ? 'К последней учебной неделе' : 'К этой неделе'}</button>}
      <div className="day-picker schedule-day-picker" aria-label="Выберите день">{weekDays.map((day) => <button type="button" onClick={() => setSelectedDate(day.date)} disabled={!day.enabled} className={`${day.date === selectedDate ? 'selected ' : ''}${day.date === today.iso ? 'today' : ''}`} aria-pressed={day.date === selectedDate} aria-label={scheduleDateLabel(day.date, day.date === today.iso)} key={day.date}><strong>{day.short}</strong><span>{Number(day.date.slice(-2))}</span></button>)}</div>
      <p className="date-label">{scheduleDateLabel(selectedDate, isToday)}</p>
    </>}
    {cachedAt && <OfflineDataNote savedAt={cachedAt} />}
    {yearState === 'ready' && state === 'loading' && <p className="child-cloud-state" role="status">Загружаем твоё расписание…</p>}
    {yearState === 'ready' && state === 'error' && <p className="auth-message error" role="alert">{online ? 'Не получилось загрузить расписание. Попробуй ещё раз.' : 'Для этого дня ещё нет сохранённого расписания.'}</p>}
    {yearState === 'ready' && state === 'ready' && dayLessons.length === 0 && <div className={`child-cloud-state ${nonSchoolMessage ? 'non-school-state' : ''}`}><strong>{nonSchoolMessage?.title ?? 'На этот день уроков пока нет'}</strong>{nonSchoolMessage && <p>{nonSchoolMessage.description}</p>}</div>}
    {yearState === 'ready' && state === 'ready' && dayLessons.length > 0 && <div className="timeline">{dayLessons.map((lesson) => <article className={`lesson-card ${lesson.status === 'cancelled' ? 'cancelled-lesson' : ''}`} key={`${lesson.weekday}-${lesson.lesson_order}-${lesson.status}-${lesson.subject_title}`}><time>{timeRange(lesson)}</time><span className="timeline-dot" /><div><p className="eyebrow">{lessonStatusLabel(lesson)}</p><h2>{lesson.subject_title}</h2></div>{lesson.status !== 'cancelled' && lesson.things.length > 0 && <p className="lesson-things">Взять: {lesson.things.join(' · ')}</p>}</article>)}</div>}
  </section>
}
