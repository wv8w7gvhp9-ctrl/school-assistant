import { useEffect, useState, type FormEvent } from 'react'
import { clubTimeRange, clubWeekdays, nextDateForWeekday, validateClubDraft, type CloudClub, type ClubDraft } from '../domain/clubs'
import { parseThings } from '../domain/schedule'
import { samaraIsoDate } from '../domain/homework'
import { supabase } from '../lib/supabase'

const emptyDraft = (): ClubDraft => ({ title: '', weekday: '1', startsAt: '17:00', endsAt: '18:00', things: '', reminderEnabled: true, reminderMinutes: '30' })

type ClubException = { id: string; club_id: string; original_day: string; kind: 'cancelled' | 'rescheduled'; replacement_day: string | null }

export function ParentClubsEditor({ familyId, childId }: { familyId: string; childId: string }) {
  const [clubs, setClubs] = useState<CloudClub[]>([])
  const [exceptions, setExceptions] = useState<ClubException[]>([])
  const [draft, setDraft] = useState<ClubDraft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [exceptionClubId, setExceptionClubId] = useState('')
  const [exceptionKind, setExceptionKind] = useState<'cancelled' | 'rescheduled'>('cancelled')
  const [originalDay, setOriginalDay] = useState(samaraIsoDate())
  const [replacement, setReplacement] = useState({ day: '', startsAt: '', endsAt: '', things: '' })
  const [savingException, setSavingException] = useState(false)

  async function loadClubs() {
    if (!supabase) return
    const [clubResult, exceptionResult] = await Promise.all([
      supabase.from('clubs').select('id, title, weekday, starts_at, ends_at, things, reminder_enabled, reminder_minutes, active').eq('family_id', familyId).eq('child_id', childId).order('weekday').order('starts_at'),
      supabase.from('club_exceptions').select('id, club_id, original_day, kind, replacement_day').eq('family_id', familyId).order('original_day', { ascending: false }).limit(12),
    ])
    if (clubResult.error) throw clubResult.error
    if (exceptionResult.error) throw exceptionResult.error
    setClubs((clubResult.data ?? []) as CloudClub[])
    setExceptions((exceptionResult.data ?? []) as ClubException[])
  }

  useEffect(() => {
    let active = true
    void loadClubs().catch((loadError) => {
      console.error('Не удалось загрузить кружки родителя', loadError)
      if (active) setError('Не удалось загрузить кружки. Проверьте интернет и попробуйте ещё раз.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [familyId, childId])

  async function saveClub(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || saving) return
    const validationError = validateClubDraft(draft)
    if (validationError) { setError(validationError); return }
    setSaving(true); setError(''); setMessage('')
    const values = { title: draft.title.trim(), weekday: Number(draft.weekday), starts_at: draft.startsAt, ends_at: draft.endsAt || null, things: parseThings(draft.things), reminder_enabled: draft.reminderEnabled, reminder_minutes: Number(draft.reminderMinutes || 30), active: true, updated_at: new Date().toISOString() }
    const request = editingId ? supabase.from('clubs').update(values).eq('id', editingId).eq('family_id', familyId) : supabase.from('clubs').insert({ ...values, family_id: familyId, child_id: childId })
    const { error: saveError } = await request
    if (saveError) setError('Не удалось сохранить кружок. Проверьте данные и попробуйте ещё раз.')
    else { await loadClubs(); setDraft(emptyDraft()); setEditingId(null); setMessage(editingId ? 'Изменения кружка сохранены.' : 'Кружок добавлен в регулярное расписание.') }
    setSaving(false)
  }

  function beginEditing(club: CloudClub) {
    setEditingId(club.id); setDeletingId(null); setError(''); setMessage('')
    setDraft({ title: club.title, weekday: String(club.weekday), startsAt: club.starts_at.slice(0, 5), endsAt: club.ends_at?.slice(0, 5) ?? '', things: club.things.join(', '), reminderEnabled: club.reminder_enabled, reminderMinutes: String(club.reminder_minutes) })
  }

  async function deleteClub(id: string) {
    if (!supabase || busyId) return
    setBusyId(id); setError('')
    const { error: deleteError } = await supabase.from('clubs').delete().eq('id', id).eq('family_id', familyId)
    if (deleteError) setError('Не удалось удалить кружок. Проверьте интернет и попробуйте ещё раз.')
    else { setClubs((current) => current.filter((club) => club.id !== id)); setDeletingId(null); setMessage('Кружок удалён вместе с будущими изменениями.') }
    setBusyId(null)
  }

  function selectExceptionClub(id: string) {
    setExceptionClubId(id)
    const club = clubs.find((item) => item.id === id)
    if (club) setOriginalDay(nextDateForWeekday(samaraIsoDate(), club.weekday))
  }

  async function saveException(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !exceptionClubId || savingException) return
    const club = clubs.find((item) => item.id === exceptionClubId)
    if (!club || nextDateForWeekday(originalDay, club.weekday) !== originalDay) { setError('Выберите дату, которая совпадает с днём регулярного кружка.'); return }
    if (exceptionKind === 'rescheduled' && !replacement.day) { setError('Выберите новую дату занятия.'); return }
    if (replacement.endsAt && replacement.startsAt && replacement.endsAt <= replacement.startsAt) { setError('Новое время окончания должно быть позже начала.'); return }
    setSavingException(true); setError(''); setMessage('')
    const { error: saveError } = await supabase.from('club_exceptions').insert({ family_id: familyId, club_id: exceptionClubId, original_day: originalDay, kind: exceptionKind, replacement_day: exceptionKind === 'rescheduled' ? replacement.day : null, starts_at: exceptionKind === 'rescheduled' && replacement.startsAt ? replacement.startsAt : null, ends_at: exceptionKind === 'rescheduled' && replacement.endsAt ? replacement.endsAt : null, things: exceptionKind === 'rescheduled' && replacement.things.trim() ? parseThings(replacement.things) : null })
    if (saveError) setError(saveError.code === '23505' ? 'Для этого занятия на выбранную дату изменение уже сохранено.' : 'Не удалось сохранить изменение. Проверьте даты и попробуйте ещё раз.')
    else { await loadClubs(); setMessage(exceptionKind === 'cancelled' ? 'Отмена занятия сохранена.' : 'Перенос занятия сохранён.'); setReplacement({ day: '', startsAt: '', endsAt: '', things: '' }) }
    setSavingException(false)
  }

  return <section className="parent-clubs" aria-labelledby="parent-clubs-title"><div className="parent-section-heading"><div><p className="eyebrow">Для родителя</p><h2 id="parent-clubs-title">Кружки</h2></div></div><p>Добавьте регулярное занятие, вещи с собой и напоминание.</p>
    <form className="auth-form parent-club-form" onSubmit={saveClub}><h3>{editingId ? 'Изменить кружок' : 'Добавить кружок'}</h3><label htmlFor="club-title">Название</label><input id="club-title" type="text" maxLength={160} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Например, Робототехника" required /><label htmlFor="club-weekday">День недели</label><select id="club-weekday" className="parent-select" value={draft.weekday} onChange={(event) => setDraft((current) => ({ ...current, weekday: event.target.value }))}>{clubWeekdays.map((day) => <option value={day.value} key={day.value}>{day.full}</option>)}</select><div className="parent-form-grid"><div><label htmlFor="club-start">Начало</label><input id="club-start" type="time" value={draft.startsAt} onChange={(event) => setDraft((current) => ({ ...current, startsAt: event.target.value }))} required /></div><div><label htmlFor="club-end">Окончание</label><input id="club-end" type="time" value={draft.endsAt} onChange={(event) => setDraft((current) => ({ ...current, endsAt: event.target.value }))} /></div></div><label htmlFor="club-things">Что взять с собой</label><input id="club-things" type="text" value={draft.things} onChange={(event) => setDraft((current) => ({ ...current, things: event.target.value }))} placeholder="Форма, бутылка воды" /><label className="switch-row"><input type="checkbox" checked={draft.reminderEnabled} onChange={(event) => setDraft((current) => ({ ...current, reminderEnabled: event.target.checked }))} /><span>Напоминать о занятии</span></label>{draft.reminderEnabled && <><label htmlFor="club-reminder">За сколько минут</label><input id="club-reminder" type="number" min="0" max="1440" inputMode="numeric" value={draft.reminderMinutes} onChange={(event) => setDraft((current) => ({ ...current, reminderMinutes: event.target.value }))} required /></>}<button className="primary-button" type="submit" disabled={saving}>{saving ? 'Сохраняем…' : editingId ? 'Сохранить изменения' : 'Добавить кружок'}</button>{editingId && <button type="button" className="secondary-button" onClick={() => { setEditingId(null); setDraft(emptyDraft()) }}>Отменить изменение</button>}</form>
    {loading && <p className="auth-loading" role="status">Загружаем кружки…</p>}{error && <p className="auth-message error" role="alert">{error}</p>}{message && <p className="auth-message success" role="status">{message}</p>}
    {!loading && <div className="parent-club-list"><h3>Регулярные занятия</h3>{clubs.length === 0 ? <p className="parent-empty">Кружков пока нет. Добавьте первое занятие выше.</p> : clubs.map((club) => <article className="parent-club-row" key={club.id}><div><strong>{club.title}</strong><p>{clubWeekdays.find((day) => day.value === club.weekday)?.full} · {clubTimeRange(club.starts_at, club.ends_at)}</p></div>{club.things.length > 0 && <span>Взять: {club.things.join(' · ')}</span>}<span>{club.reminder_enabled ? `Напоминание за ${club.reminder_minutes} мин.` : 'Напоминание выключено'}</span><div className="parent-lesson-actions"><button type="button" onClick={() => beginEditing(club)}>Изменить</button><button type="button" onClick={() => setDeletingId(club.id)}>Удалить</button></div>{deletingId === club.id && <div className="parent-confirm"><p>Удалить кружок и все его отмены и переносы?</p><div><button type="button" className="secondary-button" onClick={() => setDeletingId(null)}>Оставить</button><button type="button" className="danger-button" disabled={busyId === club.id} onClick={() => void deleteClub(club.id)}>{busyId === club.id ? 'Удаляем…' : 'Удалить'}</button></div></div>}</article>)}</div>}
    {clubs.length > 0 && <form className="parent-exception-form" onSubmit={saveException}><h3>Отменить или перенести занятие</h3><label htmlFor="exception-club">Кружок</label><select id="exception-club" className="parent-select" value={exceptionClubId} onChange={(event) => selectExceptionClub(event.target.value)} required><option value="" disabled>Выберите кружок</option>{clubs.map((club) => <option value={club.id} key={club.id}>{club.title} · {clubWeekdays.find((day) => day.value === club.weekday)?.short}</option>)}</select><label htmlFor="club-original-day">Дата занятия</label><input id="club-original-day" type="date" value={originalDay} onChange={(event) => setOriginalDay(event.target.value)} required /><label htmlFor="club-exception-kind">Действие</label><select id="club-exception-kind" className="parent-select" value={exceptionKind} onChange={(event) => setExceptionKind(event.target.value as 'cancelled' | 'rescheduled')}><option value="cancelled">Отменить</option><option value="rescheduled">Перенести</option></select>{exceptionKind === 'rescheduled' && <><label htmlFor="club-new-day">Новая дата</label><input id="club-new-day" type="date" value={replacement.day} onChange={(event) => setReplacement((current) => ({ ...current, day: event.target.value }))} required /><div className="parent-form-grid"><div><label htmlFor="club-new-start">Новое начало</label><input id="club-new-start" type="time" value={replacement.startsAt} onChange={(event) => setReplacement((current) => ({ ...current, startsAt: event.target.value }))} /></div><div><label htmlFor="club-new-end">Новое окончание</label><input id="club-new-end" type="time" value={replacement.endsAt} onChange={(event) => setReplacement((current) => ({ ...current, endsAt: event.target.value }))} /></div></div><label htmlFor="club-new-things">Что взять после переноса</label><input id="club-new-things" type="text" value={replacement.things} onChange={(event) => setReplacement((current) => ({ ...current, things: event.target.value }))} placeholder="Можно оставить пустым" /></>}<button type="submit" className="secondary-button" disabled={savingException || !exceptionClubId}>{savingException ? 'Сохраняем…' : exceptionKind === 'cancelled' ? 'Отменить занятие' : 'Сохранить перенос'}</button></form>}
    {exceptions.length > 0 && <div className="parent-club-list"><h3>Последние изменения</h3>{exceptions.map((item) => <p className="parent-club-exception" key={item.id}>{clubs.find((club) => club.id === item.club_id)?.title ?? 'Кружок'} · {item.original_day} · {item.kind === 'cancelled' ? 'отменено' : `перенесено на ${item.replacement_day}`}</p>)}</div>}
  </section>
}
