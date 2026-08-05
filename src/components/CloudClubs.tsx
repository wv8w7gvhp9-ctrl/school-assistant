import { useEffect, useState } from 'react'
import { addDays, samaraIsoDate } from '../domain/homework'
import { clubTimeRange, clubWeekdays, nextActiveOccurrence, reminderTime, type CloudClub, type ClubOccurrence } from '../domain/clubs'
import { supabase } from '../lib/supabase'
import { loadWithOfflineFallback, offlineKey } from '../lib/offlineCache'
import { Icon } from './Icon'
import { useChildSession } from './ChildSession'
import { OfflineDataNote, useOnlineStatus } from './NetworkStatus'

function formatClubDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Samara' }).format(new Date(`${value}T12:00:00+04:00`))
}

export function CloudClubs() {
  const profile = useChildSession()
  const online = useOnlineStatus()
  const [clubs, setClubs] = useState<CloudClub[]>([])
  const [occurrences, setOccurrences] = useState<ClubOccurrence[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [cachedAt, setCachedAt] = useState<string | null>(null)

  async function loadClubs() {
    if (!supabase || !profile) return
    setState('loading')
    const today = samaraIsoDate()
    const through = addDays(today, 28)
    const [clubResult, occurrenceResult] = await Promise.all([
      loadWithOfflineFallback<CloudClub[]>(offlineKey.clubs(profile.childId), () => supabase!.rpc('get_my_clubs'), online),
      loadWithOfflineFallback<ClubOccurrence[]>(offlineKey.clubOccurrences(profile.childId, today, through), () => supabase!.rpc('get_my_club_occurrences', { input_from: today, input_to: through }), online),
    ])
    if (clubResult.source === 'none' || occurrenceResult.source === 'none') {
      console.error('Не удалось загрузить кружки ребёнка', clubResult.error ?? occurrenceResult.error)
      setState('error')
      return
    }
    setClubs(clubResult.data ?? [])
    setOccurrences(occurrenceResult.data ?? [])
    setCachedAt(clubResult.source === 'cache' || occurrenceResult.source === 'cache' ? clubResult.savedAt ?? occurrenceResult.savedAt : null)
    setState('ready')
  }

  useEffect(() => { void loadClubs() }, [online, profile])

  const upcoming = nextActiveOccurrence(occurrences)
  const changes = occurrences.filter((occurrence) => occurrence.status === 'cancelled' || occurrence.status === 'rescheduled_from').slice(0, 4)

  return <section className="screen"><div className="screen-heading"><div><p className="eyebrow">После уроков</p><h1>Кружки</h1></div></div>
    {cachedAt && <OfflineDataNote savedAt={cachedAt} />}
    {state === 'loading' && <p className="child-cloud-state" role="status">Загружаем кружки…</p>}
    {state === 'error' && <div className="auth-message error" role="alert"><p>{online ? 'Не получилось загрузить кружки. Попробуй ещё раз.' : 'Сохранённых кружков на этом устройстве пока нет.'}</p><button type="button" className="secondary-button" onClick={() => void loadClubs()}>Повторить</button></div>}
    {state === 'ready' && clubs.length === 0 && <div className="child-cloud-state"><strong>Кружков пока нет</strong><p>Когда родитель добавит занятие, оно появится здесь.</p></div>}
    {state === 'ready' && clubs.length > 0 && !upcoming && <div className="child-cloud-state"><strong>Ближайших занятий пока нет</strong><p>Регулярное расписание можно посмотреть ниже.</p></div>}
    {upcoming && <article className="next-club cloud-next-club"><div className="club-icon large"><Icon name="clubs" /></div><p className="eyebrow">Ближайшее занятие</p><h2>{upcoming.title}</h2><p className="club-date">{formatClubDate(upcoming.occurs_on)} · {clubTimeRange(upcoming.starts_at, upcoming.ends_at)}</p>{upcoming.status === 'rescheduled' && <span className="club-change-status">Занятие перенесено</span>}<div className="reminder"><Icon name="clock" />{upcoming.reminder_enabled ? `Напомним в ${reminderTime(upcoming.starts_at, upcoming.reminder_minutes)}` : 'Напоминание выключено'}</div>{upcoming.things.length > 0 && <><h3>Что взять с собой</h3><div className="club-things-list">{upcoming.things.map((thing) => <div className="club-thing" key={thing}><Icon name="check" /><span>{thing}</span></div>)}</div></>}</article>}
    {changes.length > 0 && <section className="club-changes"><h2>Изменения</h2>{changes.map((occurrence) => <article className="card club-change-row" key={`${occurrence.club_id}-${occurrence.occurs_on}`}><strong>{occurrence.title}</strong><p>{formatClubDate(occurrence.occurs_on)}</p><span>{occurrence.status === 'cancelled' ? 'Занятие отменено' : `Перенесено на ${occurrence.replacement_day ? formatClubDate(occurrence.replacement_day) : 'другую дату'}`}</span></article>)}</section>}
    {clubs.length > 0 && <section className="regular-clubs"><h2>Регулярные занятия</h2><div className="club-list">{clubs.map((club) => <article className="card club-row" key={club.id}><span className="club-icon"><Icon name="clubs" /></span><div><h3>{club.title}</h3><p>{clubWeekdays.find((day) => day.value === club.weekday)?.full} · {clubTimeRange(club.starts_at, club.ends_at)}</p>{club.things.length > 0 && <span>Взять: {club.things.join(' · ')}</span>}</div></article>)}</div></section>}
  </section>
}
