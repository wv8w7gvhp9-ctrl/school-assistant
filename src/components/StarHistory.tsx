import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { formatStarEventDate, starAmountLabel, starTotal, validateStarCorrection, type StarEvent } from '../domain/stars'
import { loadWithOfflineFallback, offlineKey } from '../lib/offlineCache'
import { supabase } from '../lib/supabase'
import { useOnlineStatus, OfflineDataNote } from './NetworkStatus'
import { StarCounter } from './UI'

function StarEventList({ events }: { events: StarEvent[] }) {
  if (events.length === 0) return <p className="star-history-empty">Звёздочек пока нет. Первое начисление появится после подтверждения родителем.</p>
  return <div className="star-history-list">{events.map((event) => <article className={event.stars < 0 ? 'star-history-row negative' : 'star-history-row'} key={event.id}>
    <span className="star-history-amount" aria-label={`${event.stars > 0 ? 'Начислено' : 'Списано'} ${Math.abs(event.stars)}`}>{starAmountLabel(event.stars)}</span>
    <div><strong>{event.reason}</strong><time dateTime={event.created_at}>{formatStarEventDate(event.created_at)}</time></div>
  </article>)}</div>
}

export function ChildStarHistory({ childId }: { childId: string }) {
  const online = useOnlineStatus()
  const [events, setEvents] = useState<StarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const client = supabase
    if (!client) return
    let active = true
    setLoading(true)
    setError('')
    void loadWithOfflineFallback<StarEvent[]>(
      offlineKey.starHistory(childId),
      () => client.rpc('get_my_star_history'),
      online,
    ).then((result) => {
      if (!active) return
      if (result.data) {
        setEvents(result.data)
        setSavedAt(result.source === 'cache' ? result.savedAt : null)
        setError('')
      } else {
        setError(online ? 'Не получилось загрузить звёздочки. Попробуй ещё раз.' : 'История звёздочек ещё не сохранена на этом устройстве.')
      }
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [childId, online, reloadKey])

  return <section className="child-star-history" aria-labelledby="child-star-history-title">
    <div className="star-history-heading"><div><h3 id="child-star-history-title">Мои звёздочки</h3><p>Здесь видно, за что они появились.</p></div><StarCounter value={starTotal(events)} /></div>
    {savedAt && <OfflineDataNote savedAt={savedAt} />}
    {loading && <p className="auth-loading" role="status">Загружаем звёздочки…</p>}
    {error && <div className="auth-message error retry-message" role="alert"><p>{error}</p><button type="button" className="text-button" onClick={() => setReloadKey((value) => value + 1)}>Попробовать снова</button></div>}
    {!loading && !error && <StarEventList events={events} />}
  </section>
}

export function ParentStarHistory({ childId, childName, reviewVersion = 0 }: { childId: string; childName: string; reviewVersion?: number }) {
  const [events, setEvents] = useState<StarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const loadHistory = useCallback(async () => {
    if (!supabase) return
    const { data, error: requestError } = await supabase.rpc('get_parent_star_history', { input_child_id: childId })
    if (requestError) throw requestError
    setEvents((data ?? []) as StarEvent[])
    setError('')
  }, [childId])

  useEffect(() => {
    let active = true
    setLoading(true)
    void loadHistory().catch(() => {
      if (active) setError('Не удалось загрузить историю звёзд. Проверьте интернет и попробуйте ещё раз.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [loadHistory, reviewVersion])

  function prepareCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const validationError = validateStarCorrection(amount, reason, starTotal(events))
    if (validationError) { setError(validationError); setConfirming(false); return }
    setError('')
    setMessage('')
    setConfirming(true)
  }

  async function saveCorrection() {
    if (!supabase || saving) return
    const validationError = validateStarCorrection(amount, reason, starTotal(events))
    if (validationError) { setError(validationError); setConfirming(false); return }
    setSaving(true)
    setError('')
    setMessage('')
    const { error: saveError } = await supabase.rpc('add_star_correction', {
      input_child_id: childId,
      input_stars: Number(amount),
      input_reason: reason.trim(),
    })
    if (saveError) {
      setError('Не удалось сохранить корректировку. Обновите историю и попробуйте ещё раз.')
    } else {
      try {
        await loadHistory()
        setAmount('')
        setReason('')
        setConfirming(false)
        setMessage('Корректировка добавлена отдельной записью в историю.')
      } catch {
        setError('Корректировка сохранена, но историю не удалось обновить. Обновите страницу.')
      }
    }
    setSaving(false)
  }

  const total = starTotal(events)
  return <section className="parent-star-history" aria-labelledby="parent-star-history-title">
    <div className="parent-section-heading star-history-heading"><div><p className="eyebrow">Для родителя</p><h2 id="parent-star-history-title">Звёздочки</h2></div><StarCounter value={total} /></div>
    <p>История {childName}. Начисления не редактируются и не удаляются.</p>
    <form className="auth-form star-correction-form" onSubmit={prepareCorrection}>
      <h3>Техническая корректировка</h3>
      <p className="field-help">Используйте только для исправления ошибки. Положительное число добавит звёзды, отрицательное — спишет.</p>
      <div className="parent-form-grid"><div><label htmlFor="star-correction-amount">Количество</label><input id="star-correction-amount" type="number" min="-50" max="50" step="1" value={amount} onChange={(event) => { setAmount(event.target.value); setConfirming(false); setError('') }} placeholder="Например, -1" required /></div><div><label htmlFor="star-correction-reason">Причина</label><input id="star-correction-reason" type="text" minLength={3} maxLength={200} value={reason} onChange={(event) => { setReason(event.target.value); setConfirming(false); setError('') }} placeholder="Например, исправление дубля" required /></div></div>
      {!confirming ? <button className="secondary-button" type="submit" disabled={saving}>Проверить корректировку</button> : <div className="star-correction-confirm" role="group" aria-label="Подтверждение корректировки"><p>Добавить в историю запись <strong>{starAmountLabel(Number(amount))}</strong>? Старые события останутся без изменений.</p><div><button className="secondary-button" type="button" onClick={() => setConfirming(false)} disabled={saving}>Вернуться</button><button className="primary-button" type="button" onClick={() => void saveCorrection()} disabled={saving}>{saving ? 'Сохраняем…' : 'Добавить корректировку'}</button></div></div>}
    </form>
    {loading && <p className="auth-loading" role="status">Загружаем историю звёзд…</p>}
    {error && <div className="auth-message error retry-message" role="alert"><p>{error}</p><button type="button" className="text-button" onClick={() => { setLoading(true); void loadHistory().catch(() => setError('Не удалось загрузить историю звёзд. Проверьте интернет и попробуйте ещё раз.')).finally(() => setLoading(false)) }}>Попробовать снова</button></div>}
    {message && <p className="auth-message success" role="status">{message}</p>}
    {!loading && <StarEventList events={events} />}
  </section>
}
