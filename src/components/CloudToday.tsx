import { useEffect, useMemo, useState } from 'react'
import { useChildSession } from './ChildSession'
import { Icon } from './Icon'
import { SectionTitle, StarCounter, StatusChip } from './UI'
import { timeRange, type CloudLesson } from '../domain/childSchedule'
import { clubTimeRange, type ClubOccurrence } from '../domain/clubs'
import { samaraIsoDate, type CloudHomeworkAssignment } from '../domain/homework'
import { activeTodayClubs, activeTodayLessons, actionableTodayHomework, backpackProgress, formatFullRussianDate, type BackpackItem, type BackpackStatus } from '../domain/today'
import { supabase } from '../lib/supabase'
import { loadWithOfflineFallback, offlineKey, saveOfflineSnapshot } from '../lib/offlineCache'
import { OfflineDataNote, useOnlineStatus } from './NetworkStatus'

type BackpackResponseRow = BackpackItem & { item_id: string | null; item_text: string | null; subject_titles: string[] | null; checked: boolean | null }

export function CloudToday() {
  const profile = useChildSession()
  const online = useOnlineStatus()
  const today = useMemo(samaraIsoDate, [])
  const [lessons, setLessons] = useState<CloudLesson[]>([])
  const [homework, setHomework] = useState<CloudHomeworkAssignment[]>([])
  const [clubs, setClubs] = useState<ClubOccurrence[]>([])
  const [backpack, setBackpack] = useState<BackpackItem[]>([])
  const [backpackMeta, setBackpackMeta] = useState<{ id: string; day: string; status: BackpackStatus } | null>(null)
  const [stars, setStars] = useState(0)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [backpackError, setBackpackError] = useState(false)
  const [backpackOpen, setBackpackOpen] = useState(false)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [cachedAt, setCachedAt] = useState<string | null>(null)

  async function loadToday() {
    if (!supabase || !profile) return
    setState('loading')
    const [lessonResult, homeworkResult, clubResult, backpackResult, starResult] = await Promise.all([
      loadWithOfflineFallback<CloudLesson[]>(offlineKey.schedule(profile.childId, today), () => supabase!.rpc('get_my_schedule_for_date', { input_day: today }), online),
      loadWithOfflineFallback<CloudHomeworkAssignment[]>(offlineKey.homework(profile.childId), () => supabase!.rpc('get_my_homework'), online),
      loadWithOfflineFallback<ClubOccurrence[]>(offlineKey.clubOccurrences(profile.childId, today, today), () => supabase!.rpc('get_my_club_occurrences', { input_from: today, input_to: today }), online),
      loadWithOfflineFallback<BackpackResponseRow[]>(offlineKey.backpack(profile.childId), () => supabase!.rpc('get_my_backpack'), online),
      loadWithOfflineFallback<number>(offlineKey.stars(profile.childId), () => supabase!.rpc('get_my_star_count'), online),
    ])
    if (lessonResult.source === 'none' || homeworkResult.source === 'none' || clubResult.source === 'none') {
      console.error('Не удалось загрузить экран «Сегодня»', lessonResult.error ?? homeworkResult.error ?? clubResult.error)
      setState('error')
      return
    }
    setLessons(lessonResult.data ?? [])
    setHomework(homeworkResult.data ?? [])
    setClubs(clubResult.data ?? [])
    if (backpackResult.source === 'none') {
      console.error('Не удалось подготовить рюкзак', backpackResult.error)
      setBackpackError(true)
      setBackpack([])
      setBackpackMeta(null)
    } else {
      const backpackRows = backpackResult.data ?? []
      const firstBackpackRow = backpackRows[0]
      setBackpack(backpackRows.filter((row) => row.item_id && row.item_text).map((row) => ({ checklist_id: row.checklist_id, target_day: row.target_day, status: row.status, item_id: row.item_id!, item_text: row.item_text!, subject_titles: row.subject_titles ?? [], checked: Boolean(row.checked) })))
      setBackpackMeta(firstBackpackRow ? { id: firstBackpackRow.checklist_id, day: firstBackpackRow.target_day, status: firstBackpackRow.status } : null)
      setBackpackError(false)
    }
    if (starResult.source === 'none') console.error('Не удалось загрузить число звёзд', starResult.error)
    setStars(starResult.source === 'none' ? 0 : Number(starResult.data ?? 0))
    const cachedResult = [lessonResult, homeworkResult, clubResult, backpackResult, starResult].find((result) => result.source === 'cache')
    setCachedAt(cachedResult?.savedAt ?? null)
    setState('ready')
  }

  useEffect(() => { void loadToday() }, [online, profile])

  const todayLessons = activeTodayLessons(lessons)
  const todayHomework = actionableTodayHomework(homework, today)
  const todayClubs = activeTodayClubs(clubs)
  const progress = backpackProgress(backpack)
  const firstLesson = todayLessons[0]
  const firstClub = todayClubs[0]

  async function toggleItem(item: BackpackItem) {
    if (!supabase || !profile || !online || busyItemId || backpackMeta?.status !== 'packing') return
    setBusyItemId(item.item_id)
    setMessage('')
    const nextChecked = !item.checked
    const { error } = await supabase.rpc('set_my_backpack_item', { input_item_id: item.item_id, input_checked: nextChecked })
    if (error) {
      console.error('Не удалось изменить вещь в рюкзаке', error)
      setMessage('Не получилось сохранить отметку. Проверь интернет и попробуй ещё раз.')
    } else {
      const updated = backpack.map((currentItem) => currentItem.item_id === item.item_id ? { ...currentItem, checked: nextChecked } : currentItem)
      setBackpack(updated)
      await saveOfflineSnapshot(offlineKey.backpack(profile.childId), updated)
    }
    setBusyItemId(null)
  }

  async function submitBackpack() {
    if (!supabase || !profile || !online || !backpackMeta || submitting || progress.total === 0 || progress.checked !== progress.total) return
    setSubmitting(true)
    setMessage('')
    const { error } = await supabase.rpc('submit_my_backpack', { input_checklist_id: backpackMeta.id })
    if (error) {
      console.error('Не удалось отправить рюкзак на проверку', error)
      setMessage('Не получилось отправить рюкзак. Проверь интернет и попробуй ещё раз.')
    } else {
      setBackpackMeta((current) => current ? { ...current, status: 'pending_review' } : current)
      const updated = backpack.map((item) => ({ ...item, status: 'pending_review' as const }))
      setBackpack(updated)
      await saveOfflineSnapshot(offlineKey.backpack(profile.childId), updated)
      setMessage('Рюкзак отправлен родителю на проверку.')
    }
    setSubmitting(false)
  }

  return <section className="screen cloud-today"><div className="screen-heading"><div><h1>Привет, {profile?.childName}!</h1><p className="today-date">{formatFullRussianDate(today)}</p></div><StarCounter value={stars} /></div>
    {cachedAt && <OfflineDataNote savedAt={cachedAt} />}
    {state === 'loading' && <p className="child-cloud-state" role="status">Собираем твой сегодняшний день…</p>}
    {state === 'error' && <div className="auth-message error" role="alert"><p>{online ? 'Не получилось загрузить сегодняшний день. Попробуй ещё раз.' : 'Сегодняшний день ещё не был сохранён на этом устройстве.'}</p><button type="button" className="secondary-button" onClick={() => void loadToday()}>Повторить</button></div>}
    {state === 'ready' && <>
      <article className="hero-card"><div><p className="eyebrow">{firstLesson ? 'Ближайшее событие' : firstClub ? 'После уроков' : 'Спокойный день'}</p><h2>{firstLesson ? `Первый урок в ${firstLesson.starts_at.slice(0, 5)}` : firstClub ? `${firstClub.title} в ${firstClub.starts_at.slice(0, 5)}` : 'Сегодня без занятий'}</h2><p>{firstLesson ? `${firstLesson.subject_title} · Сегодня всё получится` : firstClub ? 'Не забудь вещи с собой' : backpackMeta ? `Рюкзак собираем на ${formatFullRussianDate(backpackMeta.day).toLowerCase()}` : 'Можно отдохнуть и почитать'}</p></div><div className="hero-icon" aria-hidden="true"><Icon name={firstLesson ? 'sun' : firstClub ? 'clubs' : 'books'} /></div></article>
      <SectionTitle>Уроки сегодня</SectionTitle>
      {todayLessons.length === 0 ? <div className="child-cloud-state compact"><strong>Уроков сегодня нет</strong><p>Следующий учебный день указан в рюкзаке.</p></div> : <div className="card lesson-list">{todayLessons.map((lesson) => <div className="lesson-row" key={`${lesson.lesson_order}-${lesson.starts_at}`}><time>{lesson.starts_at.slice(0, 5)}</time><span className="subject-dot math" /><div><strong>{lesson.subject_title}</strong>{lesson.things.length > 0 && <p>{lesson.things.join(' · ')}</p>}</div></div>)}</div>}
      {todayClubs.length > 0 && <><SectionTitle>После уроков</SectionTitle>{todayClubs.map((club) => <article className="card club-summary" key={`${club.club_id}-${club.starts_at}`}><span className="club-icon"><Icon name="clubs" /></span><div><strong>{club.title}</strong><p>{clubTimeRange(club.starts_at, club.ends_at)}</p></div></article>)}</>}
      <SectionTitle>Домашка</SectionTitle>
      {todayHomework.length === 0 ? <div className="child-cloud-state compact"><strong>Всё сделано</strong><p>На сегодня нет заданий, которые нужно выполнить.</p></div> : <div className="today-homework-list">{todayHomework.slice(0, 3).map((assignment) => <article className="card today-homework" key={assignment.id}><div><strong>{assignment.subject_title}</strong><p>{assignment.task}</p></div><StatusChip status={assignment.status} /></article>)}</div>}
      <button className="primary-button backpack-open-button" type="button" onClick={() => setBackpackOpen(true)} disabled={!backpackMeta}><Icon name="backpack" />{backpackMeta?.status === 'approved' ? 'Рюкзак подтверждён' : backpackMeta?.status === 'pending_review' ? 'Рюкзак ждёт проверки' : 'Собрать рюкзак'}</button>
      {backpackError ? <div className="auth-message error" role="alert"><p>Не получилось подготовить рюкзак. Остальные данные дня доступны.</p><button type="button" className="secondary-button" onClick={() => void loadToday()}>Повторить</button></div> : !backpackMeta && <p className="screen-note">Ближайший учебный день пока не найден.</p>}
    </>}
    {backpackOpen && backpackMeta && <div className="sheet-backdrop"><section className="backpack-sheet" role="dialog" aria-modal="true" aria-labelledby="backpack-title"><div className="sheet-heading"><div><p className="eyebrow">На {formatFullRussianDate(backpackMeta.day).toLowerCase()}</p><h2 id="backpack-title">Собрать рюкзак</h2></div><button type="button" className="sheet-close" aria-label="Закрыть рюкзак" onClick={() => setBackpackOpen(false)}>×</button></div>
      {backpack.length === 0 ? <div className="child-cloud-state"><strong>Список вещей пуст</strong><p>Попроси родителя добавить вещи к урокам.</p></div> : <div className="backpack-items">{backpack.map((item) => <label className="backpack-item" key={item.item_id}><input type="checkbox" checked={item.checked} disabled={!online || backpackMeta.status !== 'packing' || Boolean(busyItemId)} onChange={() => void toggleItem(item)} /><span><strong>{item.item_text}</strong><small>{item.subject_titles.join(' · ')}</small></span></label>)}</div>}
      <div className="backpack-progress"><span>Собрано {progress.checked} из {progress.total}</span><progress max={Math.max(progress.total, 1)} value={progress.checked} /></div>
      {message && <p className={message.startsWith('Рюкзак отправлен') ? 'auth-message success' : 'auth-message error'} role={message.startsWith('Рюкзак отправлен') ? 'status' : 'alert'}>{message}</p>}
      {backpackMeta.status === 'packing' && <button type="button" className="primary-button" disabled={!online || submitting || progress.total === 0 || progress.checked !== progress.total} onClick={() => void submitBackpack()}>{submitting ? 'Отправляем…' : online ? 'Рюкзак собран' : 'Нужен интернет'}</button>}
      {backpackMeta.status === 'pending_review' && <p className="auth-message success" role="status">Рюкзак ждёт проверки родителя.</p>}
      {backpackMeta.status === 'approved' && <p className="auth-message success" role="status">Родитель подтвердил рюкзак. Звезда начислена!</p>}
    </section></div>}
  </section>
}
