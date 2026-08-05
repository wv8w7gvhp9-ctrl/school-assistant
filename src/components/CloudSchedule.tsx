import { useEffect, useMemo, useState } from 'react'
import { childWeekdays, mondayFirstWeekday, timeRange, type CloudLesson } from '../domain/childSchedule'
import { supabase } from '../lib/supabase'

function samaraNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Samara', weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
  }).formatToParts(new Date())
  const value = (kind: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === kind)?.value ?? ''
  const dayNames: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  return { weekday: dayNames[value('weekday')] ?? 1, label: `${value('day')} ${value('month')} ${value('year')}` }
}

export function CloudSchedule() {
  const today = useMemo(samaraNow, [])
  const [selectedDay, setSelectedDay] = useState(today.weekday > 5 ? 1 : today.weekday)
  const [lessons, setLessons] = useState<CloudLesson[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const client = supabase
    if (!client) return
    let active = true
    void client.rpc('get_my_weekly_lessons').then(({ data, error }) => {
      if (!active) return
      if (error) {
        setState('error')
        return
      }
      setLessons((data ?? []) as CloudLesson[])
      setState('ready')
    })
    return () => { active = false }
  }, [])

  const dayLessons = lessons.filter((lesson) => lesson.weekday === selectedDay)
  const selected = childWeekdays.find((day) => day.value === selectedDay) ?? childWeekdays[0]
  const isToday = selectedDay === today.weekday

  return <section className="screen"><div className="screen-heading"><div><p className="eyebrow">Моя неделя</p><h1>Расписание</h1></div></div>
    <div className="day-picker" aria-label="Выберите день">{childWeekdays.map((day) => <button type="button" onClick={() => setSelectedDay(day.value)} className={day.value === selectedDay ? 'selected' : ''} aria-pressed={day.value === selectedDay} key={day.value}>{day.short}<span>{day.value === today.weekday ? 'сегодня' : ''}</span></button>)}</div>
    <p className="date-label">{isToday ? `Сегодня, ${today.label}` : selected.full}</p>
    {state === 'loading' && <p className="child-cloud-state" role="status">Загружаем твоё расписание…</p>}
    {state === 'error' && <p className="auth-message error" role="alert">Не получилось загрузить расписание. Проверь интернет и обнови страницу.</p>}
    {state === 'ready' && dayLessons.length === 0 && <p className="child-cloud-state">На этот день уроков пока нет.</p>}
    {state === 'ready' && dayLessons.length > 0 && <div className="timeline">{dayLessons.map((lesson) => <article className="lesson-card" key={`${lesson.weekday}-${lesson.lesson_order}`}><time>{timeRange(lesson)}</time><span className="timeline-dot" /><div><p className="eyebrow">Урок {lesson.lesson_order}</p><h2>{lesson.subject_title}</h2>{lesson.things.length > 0 && <p className="lesson-things">Взять: {lesson.things.join(' · ')}</p>}</div></article>)}</div>}
  </section>
}
