import { useEffect, useMemo, useState } from 'react'
import { childWeekdays, isoDateForWeekday, mondayFirstWeekday, timeRange, type CloudLesson } from '../domain/childSchedule'
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
  const [selectedDay, setSelectedDay] = useState(today.weekday > 5 ? 1 : today.weekday)
  const [weekOffset, setWeekOffset] = useState(0)
  const [lessons, setLessons] = useState<CloudLesson[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [cachedAt, setCachedAt] = useState<string | null>(null)
  const selectedDate = isoDateForWeekday(today.iso, today.weekday, selectedDay + weekOffset * 7)

  useEffect(() => {
    const client = supabase
    if (!client || !profile) return
    let active = true
    setState('loading')
    void loadWithOfflineFallback<CloudLesson[]>(offlineKey.schedule(profile.childId, selectedDate), () => client.rpc('get_my_schedule_for_date', { input_day: selectedDate }), online).then((result) => {
      if (!active) return
      if (result.source === 'none') {
        setState('error')
        return
      }
      setLessons(result.data ?? [])
      setCachedAt(result.source === 'cache' ? result.savedAt : null)
      setState('ready')
    })
    return () => { active = false }
  }, [online, profile, selectedDate])

  const dayLessons = lessons.filter((lesson) => lesson.weekday === selectedDay)
  const selected = childWeekdays.find((day) => day.value === selectedDay) ?? childWeekdays[0]
  const isToday = weekOffset === 0 && selectedDay === today.weekday

  return <section className="screen"><div className="screen-heading"><div><p className="eyebrow">Моя неделя</p><h1>Расписание</h1></div></div>
    <div className="week-picker" aria-label="Выберите неделю"><button type="button" className={weekOffset === 0 ? 'selected' : ''} onClick={() => setWeekOffset(0)}>Эта неделя</button><button type="button" className={weekOffset === 1 ? 'selected' : ''} onClick={() => setWeekOffset(1)}>Следующая</button></div>
    <div className="day-picker" aria-label="Выберите день">{childWeekdays.map((day) => <button type="button" onClick={() => setSelectedDay(day.value)} className={`${day.value === selectedDay ? 'selected ' : ''}${weekOffset === 0 && day.value === today.weekday ? 'today' : ''}`} aria-pressed={day.value === selectedDay} aria-label={`${day.full}${weekOffset === 0 && day.value === today.weekday ? ', сегодня' : ''}`} key={day.value}>{day.short}</button>)}</div>
    <p className="date-label">{isToday ? `Сегодня, ${today.label}` : selected.full}</p>
    {cachedAt && <OfflineDataNote savedAt={cachedAt} />}
    {state === 'loading' && <p className="child-cloud-state" role="status">Загружаем твоё расписание…</p>}
    {state === 'error' && <p className="auth-message error" role="alert">{online ? 'Не получилось загрузить расписание. Попробуй ещё раз.' : 'Для этого дня ещё нет сохранённого расписания.'}</p>}
    {state === 'ready' && dayLessons.length === 0 && <p className="child-cloud-state">На этот день уроков пока нет.</p>}
    {state === 'ready' && dayLessons.length > 0 && <div className="timeline">{dayLessons.map((lesson) => <article className={`lesson-card ${lesson.status === 'cancelled' ? 'cancelled-lesson' : ''}`} key={`${lesson.weekday}-${lesson.lesson_order}`}><time>{timeRange(lesson)}</time><span className="timeline-dot" /><div><p className="eyebrow">{lesson.status === 'cancelled' ? 'Урок отменён' : lesson.status === 'replacement' ? 'Замена' : `Урок ${lesson.lesson_order}`}</p><h2>{lesson.subject_title}</h2></div>{lesson.status !== 'cancelled' && lesson.things.length > 0 && <p className="lesson-things">Взять: {lesson.things.join(' · ')}</p>}</article>)}</div>}
  </section>
}
