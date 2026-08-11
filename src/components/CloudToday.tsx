import { useEffect, useMemo, useState } from 'react'
import { schoolDayMessage, type CloudLesson, type SchoolDayStatus } from '../domain/childSchedule'
import { clubTimeRange, type ClubOccurrence } from '../domain/clubs'
import { samaraIsoDate, type CloudHomeworkAssignment } from '../domain/homework'
import { activeTodayClubs, activeTodayLessons, actionableTodayHomework, backpackProgress, formatFullRussianDate, type BackpackItem, type BackpackStatus } from '../domain/today'
import { loadWithOfflineFallback, offlineKey, saveOfflineSnapshot } from '../lib/offlineCache'
import { enqueueBackpackItem, enqueueBackpackSubmission, listBackpackMutations, notifyOfflineQueueChanged, offlineQueueSyncedEvent, type OfflineSyncResult } from '../lib/offlineQueue'
import { supabase } from '../lib/supabase'
import { useChildSession } from './ChildSession'
import { Icon } from './Icon'
import { OfflineDataNote, useOnlineStatus } from './NetworkStatus'
import { SectionTitle, StarCounter, StatusChip } from './UI'

type BackpackResponseRow = {
  checklist_id: string
  target_day: string
  status: BackpackStatus
  checklist_updated_at: string | null
  item_id: string | null
  item_text: string | null
  subject_titles: string[] | null
  checked: boolean | null
  item_updated_at: string | null
}

type BackpackMessage = { kind: 'success' | 'warning' | 'error'; text: string } | null

export function CloudToday() {
  const profile = useChildSession()
  const online = useOnlineStatus()
  const today = useMemo(samaraIsoDate, [])
  const [lessons, setLessons] = useState<CloudLesson[]>([])
  const [schoolDayStatus, setSchoolDayStatus] = useState<SchoolDayStatus | null>(null)
  const [homework, setHomework] = useState<CloudHomeworkAssignment[]>([])
  const [clubs, setClubs] = useState<ClubOccurrence[]>([])
  const [backpack, setBackpack] = useState<BackpackItem[]>([])
  const [backpackMeta, setBackpackMeta] = useState<{ id: string; day: string; status: BackpackStatus; updatedAt: string | null } | null>(null)
  const [stars, setStars] = useState(0)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [backpackError, setBackpackError] = useState(false)
  const [backpackOpen, setBackpackOpen] = useState(false)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<BackpackMessage>(null)
  const [cachedAt, setCachedAt] = useState<string | null>(null)
  const [queuedItemIds, setQueuedItemIds] = useState<Set<string>>(new Set())
  const [submissionQueued, setSubmissionQueued] = useState(false)

  async function refreshBackpackQueue() {
    if (!profile) return []
    try {
      const mutations = await listBackpackMutations(profile.childId)
      setQueuedItemIds(new Set(mutations.filter((mutation) => mutation.kind === 'set_backpack_item').map((mutation) => mutation.itemId)))
      setSubmissionQueued(mutations.some((mutation) => mutation.kind === 'submit_backpack'))
      return mutations
    } catch (error) {
      console.error('Не удалось прочитать локальную очередь рюкзака', error)
      setQueuedItemIds(new Set())
      setSubmissionQueued(false)
      return []
    }
  }

  async function loadToday() {
    if (!supabase || !profile) return
    setState('loading')
    const [lessonResult, schoolDayResult, homeworkResult, clubResult, backpackResult, starResult, pendingBackpackMutations] = await Promise.all([
      loadWithOfflineFallback<CloudLesson[]>(offlineKey.schedule(profile.childId, today), () => supabase!.rpc('get_my_schedule_for_date', { input_day: today }), online),
      loadWithOfflineFallback<SchoolDayStatus[]>(offlineKey.schoolDayStatus(profile.childId, today), () => supabase!.rpc('get_my_school_day_status', { input_day: today }), online),
      loadWithOfflineFallback<CloudHomeworkAssignment[]>(offlineKey.homework(profile.childId), () => supabase!.rpc('get_my_homework_v2'), online),
      loadWithOfflineFallback<ClubOccurrence[]>(offlineKey.clubOccurrences(profile.childId, today, today), () => supabase!.rpc('get_my_club_occurrences', { input_from: today, input_to: today }), online),
      loadWithOfflineFallback<BackpackResponseRow[]>(offlineKey.backpack(profile.childId), () => supabase!.rpc('get_my_backpack_v2'), online),
      loadWithOfflineFallback<number>(offlineKey.stars(profile.childId), () => supabase!.rpc('get_my_star_count'), online),
      listBackpackMutations(profile.childId).catch((error) => {
        console.error('Не удалось прочитать локальную очередь рюкзака при загрузке экрана', error)
        return []
      }),
    ])
    if (lessonResult.source === 'none' || homeworkResult.source === 'none' || clubResult.source === 'none') {
      console.error('Не удалось загрузить экран «Сегодня»', lessonResult.error ?? homeworkResult.error ?? clubResult.error)
      setState('error')
      return
    }
    setLessons(lessonResult.data ?? [])
    setSchoolDayStatus(schoolDayResult.source === 'none' ? null : schoolDayResult.data?.[0] ?? null)
    if (schoolDayResult.source === 'none') console.warn('Не удалось загрузить статус учебного дня', schoolDayResult.error)
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
      const pendingChecks = new Map<string, boolean>()
      for (const mutation of pendingBackpackMutations) {
        if (mutation.kind === 'set_backpack_item') pendingChecks.set(mutation.itemId, mutation.checked)
      }
      setBackpack(backpackRows.filter((row) => row.item_id && row.item_text).map((row) => ({
        checklist_id: row.checklist_id,
        target_day: row.target_day,
        status: row.status,
        checklist_updated_at: row.checklist_updated_at ?? undefined,
        item_id: row.item_id!,
        item_text: row.item_text!,
        subject_titles: row.subject_titles ?? [],
        checked: pendingChecks.get(row.item_id!) ?? Boolean(row.checked),
        item_updated_at: row.item_updated_at ?? undefined,
      })))
      setBackpackMeta(firstBackpackRow ? {
        id: firstBackpackRow.checklist_id,
        day: firstBackpackRow.target_day,
        status: firstBackpackRow.status,
        updatedAt: firstBackpackRow.checklist_updated_at,
      } : null)
      setBackpackError(false)
    }
    const pendingItemIds = new Set<string>()
    for (const mutation of pendingBackpackMutations) {
      if (mutation.kind === 'set_backpack_item') pendingItemIds.add(mutation.itemId)
    }
    setQueuedItemIds(pendingItemIds)
    setSubmissionQueued(pendingBackpackMutations.some((mutation) => mutation.kind === 'submit_backpack'))
    if (starResult.source === 'none') console.error('Не удалось загрузить число звёзд', starResult.error)
    setStars(starResult.source === 'none' ? 0 : Number(starResult.data ?? 0))
    const cachedResult = [lessonResult, schoolDayResult, homeworkResult, clubResult, backpackResult, starResult].find((result) => result.source === 'cache')
    setCachedAt(cachedResult?.savedAt ?? null)
    setState('ready')
  }

  useEffect(() => { void loadToday() }, [online, profile])

  useEffect(() => {
    if (!profile) return
    const handleSync = (event: Event) => {
      const detail = (event as CustomEvent<{ childId: string; results: OfflineSyncResult[] }>).detail
      if (!detail || detail.childId !== profile.childId) return
      const backpackResults = detail.results.filter((result) => result.mutation.kind === 'set_backpack_item' || result.mutation.kind === 'submit_backpack')
      if (backpackResults.length === 0) return
      void refreshBackpackQueue()
      if (backpackResults.some((result) => result.outcome === 'conflict' || result.outcome === 'missing' || result.outcome === 'not_ready')) {
        setMessage({ kind: 'warning', text: 'Рюкзак изменился. Проверь актуальный список вещей.' })
      } else if (backpackResults.some((result) => result.mutation.kind === 'submit_backpack' && result.outcome !== 'retry')) {
        setMessage({ kind: 'success', text: 'Рюкзак отправлен родителю на проверку.' })
      } else if (backpackResults.some((result) => result.outcome === 'retry')) {
        setMessage({ kind: 'warning', text: 'Действие сохранено на устройстве. Отправим автоматически.' })
      } else {
        setMessage({ kind: 'success', text: 'Отметки рюкзака сохранены.' })
      }
      if (online && backpackResults.some((result) => result.outcome !== 'retry')) void loadToday()
    }
    void refreshBackpackQueue()
    window.addEventListener(offlineQueueSyncedEvent, handleSync)
    return () => window.removeEventListener(offlineQueueSyncedEvent, handleSync)
  }, [online, profile])

  const todayLessons = activeTodayLessons(lessons)
  const todayHomework = actionableTodayHomework(homework, today)
  const todayClubs = activeTodayClubs(clubs)
  const progress = backpackProgress(backpack)
  const firstLesson = todayLessons[0]
  const firstClub = todayClubs[0]
  const nonSchoolMessage = schoolDayMessage(schoolDayStatus?.reason)

  async function toggleItem(item: BackpackItem) {
    if (!profile || busyItemId || backpackMeta?.status !== 'packing' || submissionQueued) return
    if (!item.item_updated_at) {
      setMessage({ kind: 'error', text: 'Сначала открой рюкзак с интернетом, затем попробуй ещё раз.' })
      return
    }
    setBusyItemId(item.item_id)
    setMessage(null)
    const nextChecked = !item.checked
    try {
      await enqueueBackpackItem(profile.childId, item.checklist_id, item.item_id, nextChecked, item.item_updated_at)
      const updated = backpack.map((currentItem) => currentItem.item_id === item.item_id ? { ...currentItem, checked: nextChecked } : currentItem)
      setBackpack(updated)
      setQueuedItemIds((current) => new Set(current).add(item.item_id))
      setMessage(online
        ? { kind: 'warning', text: 'Отметка сохранена. Отправляем…' }
        : { kind: 'warning', text: 'Отметка сохранена на устройстве. Отправим, когда появится интернет.' })
      await saveOfflineSnapshot(offlineKey.backpack(profile.childId), updated)
      notifyOfflineQueueChanged()
    } catch (error) {
      console.error('Не удалось сохранить отметку рюкзака в очереди', error)
      setMessage({ kind: 'error', text: 'Не получилось сохранить отметку на устройстве. Попробуй ещё раз.' })
    }
    setBusyItemId(null)
  }

  async function submitBackpack() {
    if (!profile || !backpackMeta || submitting || submissionQueued || progress.total === 0 || progress.checked !== progress.total) return
    if (!backpackMeta.updatedAt) {
      setMessage({ kind: 'error', text: 'Сначала открой рюкзак с интернетом, затем попробуй ещё раз.' })
      return
    }
    setSubmitting(true)
    setMessage(null)
    try {
      await enqueueBackpackSubmission(profile.childId, backpackMeta.id, backpackMeta.updatedAt)
      setSubmissionQueued(true)
      setMessage(online
        ? { kind: 'warning', text: 'Рюкзак сохранён. Отправляем родителю…' }
        : { kind: 'warning', text: 'Рюкзак сохранён на устройстве. Отправим, когда появится интернет.' })
      notifyOfflineQueueChanged()
    } catch (error) {
      console.error('Не удалось сохранить отправку рюкзака в очереди', error)
      setMessage({ kind: 'error', text: 'Не получилось сохранить рюкзак на устройстве. Попробуй ещё раз.' })
    }
    setSubmitting(false)
  }

  const backpackButtonLabel = submissionQueued
    ? 'Рюкзак ждёт отправки'
    : backpackMeta?.status === 'approved'
      ? 'Рюкзак подтверждён'
      : backpackMeta?.status === 'pending_review'
        ? 'Рюкзак ждёт проверки'
        : 'Собрать рюкзак'

  const backpackButtonDetail = backpackMeta?.status === 'approved'
    ? 'Все вещи отмечены'
    : backpackMeta?.status === 'pending_review' || submissionQueued
      ? 'Чек-лист отправлен родителю'
      : progress.total > 0
        ? `Чек-лист · ${progress.checked} из ${progress.total}`
        : 'Чек-лист вещей'

  return <section className="screen cloud-today"><div className="screen-heading"><div><h1>Привет, {profile?.childName}!</h1><p className="today-date">{formatFullRussianDate(today)}</p></div><StarCounter value={stars} /></div>
    {cachedAt && <OfflineDataNote savedAt={cachedAt} />}
    {state === 'loading' && <p className="child-cloud-state" role="status">Собираем твой сегодняшний день…</p>}
    {state === 'error' && <div className="auth-message error" role="alert"><p>{online ? 'Не получилось загрузить сегодняшний день. Попробуй ещё раз.' : 'Сегодняшний день ещё не был сохранён на этом устройстве.'}</p><button type="button" className="secondary-button" onClick={() => void loadToday()}>Повторить</button></div>}
    {state === 'ready' && <>
      <article className="hero-card"><div><p className="eyebrow">{firstLesson ? 'Ближайшее событие' : firstClub ? 'После уроков' : nonSchoolMessage ? 'Неучебный день' : 'Спокойный день'}</p><h2>{firstLesson ? `Первый урок в ${firstLesson.starts_at.slice(0, 5)}` : firstClub ? `${firstClub.title} в ${firstClub.starts_at.slice(0, 5)}` : nonSchoolMessage?.title ?? 'Сегодня без занятий'}</h2><p>{firstLesson ? `${firstLesson.subject_title} · Сегодня всё получится` : firstClub ? 'Не забудь вещи с собой' : nonSchoolMessage ? `${nonSchoolMessage.description}${backpackMeta ? ` Рюкзак собираем на ${formatFullRussianDate(backpackMeta.day).toLowerCase()}.` : ''}` : backpackMeta ? `Рюкзак собираем на ${formatFullRussianDate(backpackMeta.day).toLowerCase()}` : 'Можно отдохнуть и почитать'}</p></div><div className="hero-icon" aria-hidden="true"><Icon name={firstLesson ? 'sun' : firstClub ? 'clubs' : 'books'} /></div></article>
      <SectionTitle>Уроки сегодня</SectionTitle>
      {todayLessons.length === 0 ? <div className={`child-cloud-state compact ${nonSchoolMessage ? 'non-school-state' : ''}`}><strong>{nonSchoolMessage?.title ?? 'Уроков сегодня нет'}</strong><p>{backpackMeta ? `Следующий учебный день — ${formatFullRussianDate(backpackMeta.day).toLowerCase()}.` : 'Следующий учебный день пока не найден.'}</p></div> : <div className="card lesson-list">{todayLessons.map((lesson) => <div className="lesson-row" key={`${lesson.lesson_order}-${lesson.starts_at}`}><time>{lesson.starts_at.slice(0, 5)}</time><span className="subject-dot math" /><div><strong>{lesson.subject_title}</strong>{lesson.things.length > 0 && <p>{lesson.things.join(' · ')}</p>}</div></div>)}</div>}
      {todayClubs.length > 0 && <><SectionTitle>После уроков</SectionTitle>{todayClubs.map((club) => <article className="card club-summary" key={`${club.club_id}-${club.starts_at}`}><span className="club-icon"><Icon name="clubs" /></span><div><strong>{club.title}</strong><p>{clubTimeRange(club.starts_at, club.ends_at)}</p></div></article>)}</>}
      <SectionTitle>Домашка</SectionTitle>
      {todayHomework.length === 0 ? <div className="child-cloud-state compact"><strong>Всё сделано</strong><p>На сегодня нет заданий, которые нужно выполнить.</p></div> : <div className="today-homework-list">{todayHomework.slice(0, 3).map((assignment) => <article className="card today-homework" key={assignment.id}><div><strong>{assignment.subject_title}</strong><p>{assignment.task}</p></div><StatusChip status={assignment.status} /></article>)}</div>}
      <button className="primary-button backpack-open-button" type="button" onClick={() => setBackpackOpen(true)} disabled={!backpackMeta} aria-label={`${backpackButtonLabel}. ${backpackButtonDetail}`}><Icon name="backpack" /><span className="backpack-button-copy"><strong>{backpackButtonLabel}</strong><small>{backpackButtonDetail}</small></span><Icon name="chevron" /></button>
      {backpackError ? <div className="auth-message error" role="alert"><p>Не получилось подготовить рюкзак. Остальные данные дня доступны.</p><button type="button" className="secondary-button" onClick={() => void loadToday()}>Повторить</button></div> : !backpackMeta && <p className="screen-note">Ближайший учебный день пока не найден.</p>}
    </>}
    {backpackOpen && backpackMeta && <div className="sheet-backdrop"><section className="backpack-sheet" role="dialog" aria-modal="true" aria-labelledby="backpack-title"><div className="sheet-heading"><div><p className="eyebrow">На {formatFullRussianDate(backpackMeta.day).toLowerCase()}</p><h2 id="backpack-title">Собрать рюкзак</h2></div><button type="button" className="sheet-close" aria-label="Закрыть рюкзак" onClick={() => setBackpackOpen(false)}>×</button></div>
      {backpack.length === 0 ? <div className="child-cloud-state"><strong>Список вещей пуст</strong><p>Попроси родителя добавить вещи к урокам.</p></div> : <div className="backpack-items">{backpack.map((item) => <label className={`backpack-item ${queuedItemIds.has(item.item_id) ? 'pending-sync' : ''}`} key={item.item_id}><input type="checkbox" checked={item.checked} disabled={backpackMeta.status !== 'packing' || submissionQueued || Boolean(busyItemId) || (online && queuedItemIds.has(item.item_id))} onChange={() => void toggleItem(item)} /><span><strong>{item.item_text}</strong><small>{item.subject_titles.join(' · ')}</small>{queuedItemIds.has(item.item_id) && <small className="pending-sync-label">Ждёт отправки</small>}</span></label>)}</div>}
      <div className="backpack-progress"><span>Собрано {progress.checked} из {progress.total}</span><progress max={Math.max(progress.total, 1)} value={progress.checked} /></div>
      {message && <p className={`auth-message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
      {backpackMeta.status === 'packing' && <button type="button" className="primary-button" disabled={submitting || submissionQueued || progress.total === 0 || progress.checked !== progress.total} onClick={() => void submitBackpack()}>{submitting ? 'Сохраняем…' : submissionQueued ? 'Ждёт отправки' : 'Рюкзак собран'}</button>}
      {submissionQueued && <p className="auth-message warning" role="status">Рюкзак сохранён на устройстве и ждёт отправки.</p>}
      {!submissionQueued && backpackMeta.status === 'pending_review' && <p className="auth-message success" role="status">Рюкзак ждёт проверки родителя.</p>}
      {backpackMeta.status === 'approved' && <p className="auth-message success" role="status">Родитель подтвердил рюкзак. Звезда начислена!</p>}
    </section></div>}
  </section>
}
