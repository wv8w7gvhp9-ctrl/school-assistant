import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  academicHistoryFilename,
  academicHistoryToCsv,
  filterAcademicHistory,
  formatAcademicYear,
  formatHistoryDate,
  historyCategoryLabels,
  historyFilters,
  historyStatusLabel,
  type AcademicHistoryEvent,
  type AcademicYearSummary,
  type HistoryFilter,
} from '../domain/history'
import { supabase } from '../lib/supabase'

function downloadHistory(year: AcademicYearSummary, events: AcademicHistoryEvent[]) {
  const blob = new Blob([academicHistoryToCsv(events)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = academicHistoryFilename(year)
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function ParentAcademicHistory({ childName }: { childName: string }) {
  const [years, setYears] = useState<AcademicYearSummary[]>([])
  const [selectedYearId, setSelectedYearId] = useState('')
  const [events, setEvents] = useState<AcademicHistoryEvent[]>([])
  const [filter, setFilter] = useState<HistoryFilter>('Все')
  const [loadingYears, setLoadingYears] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const client = supabase
    if (!client) return
    let active = true
    setLoadingYears(true)
    setError('')
    void (async () => {
      try {
        const { data, error: requestError } = await client.rpc('get_parent_academic_years')
        if (!active) return
        if (requestError) throw requestError
        const nextYears = (data ?? []) as AcademicYearSummary[]
        setYears(nextYears)
        setSelectedYearId((current) => {
          if (current && nextYears.some((year) => year.id === current)) return current
          return nextYears.find((year) => year.is_current)?.id ?? nextYears[0]?.id ?? ''
        })
      } catch {
        if (active) setError('Не удалось загрузить учебные годы. Проверьте интернет и попробуйте ещё раз.')
      } finally {
        if (active) setLoadingYears(false)
      }
    })()
    return () => { active = false }
  }, [reloadKey])

  const loadHistory = useCallback(async (yearId: string) => {
    const client = supabase
    if (!client || !yearId) return
    const { data, error: requestError } = await client.rpc('get_parent_academic_history', {
      input_academic_year_id: yearId,
    })
    if (requestError) throw requestError
    setEvents((data ?? []) as AcademicHistoryEvent[])
  }, [])

  useEffect(() => {
    if (!selectedYearId) {
      setEvents([])
      return
    }
    let active = true
    setLoadingHistory(true)
    setError('')
    setFilter('Все')
    void loadHistory(selectedYearId).catch(() => {
      if (active) setError('Не удалось загрузить историю. Проверьте интернет и попробуйте ещё раз.')
    }).finally(() => {
      if (active) setLoadingHistory(false)
    })
    return () => { active = false }
  }, [loadHistory, selectedYearId, reloadKey])

  const selectedYear = years.find((year) => year.id === selectedYearId) ?? null
  const visibleEvents = useMemo(() => filterAcademicHistory(events, filter), [events, filter])

  return <section className="parent-academic-history" aria-labelledby="parent-academic-history-title">
    <div className="parent-section-heading history-heading"><div><p className="eyebrow">Для родителя</p><h2 id="parent-academic-history-title">История</h2></div>{selectedYear?.is_completed && <span className="history-readonly">Завершён</span>}</div>
    <p>Задания, книги, рюкзак и звёзды {childName} сохраняются по учебным годам.</p>

    {loadingYears && <p className="auth-loading" role="status">Загружаем учебные годы…</p>}
    {!loadingYears && years.length === 0 && !error && <p className="parent-empty">Сначала создайте учебный год в разделе расписания.</p>}
    {years.length > 0 && <><label className="parent-select-label" htmlFor="history-academic-year">Учебный год</label><select id="history-academic-year" className="parent-select" value={selectedYearId} onChange={(event) => setSelectedYearId(event.target.value)} disabled={loadingHistory}>{years.map((year) => <option key={year.id} value={year.id}>{formatAcademicYear(year)}{year.is_current ? ' · текущий' : ''}</option>)}</select></>}

    {error && <div className="auth-message error retry-message" role="alert"><p>{error}</p><button type="button" className="text-button" onClick={() => setReloadKey((value) => value + 1)}>Попробовать снова</button></div>}
    {selectedYear && <div className="history-toolbar"><div className="filter-pills history-filters" aria-label="Фильтр истории">{historyFilters.map((item) => <button type="button" key={item} className={filter === item ? 'selected' : ''} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}</div><button type="button" className="secondary-button" disabled={loadingHistory || events.length === 0} onClick={() => downloadHistory(selectedYear, events)}>Выгрузить CSV</button></div>}

    {loadingHistory && <p className="auth-loading" role="status">Собираем историю…</p>}
    {!loadingHistory && selectedYear && !error && events.length === 0 && <p className="parent-empty">В этом учебном году событий пока нет.</p>}
    {!loadingHistory && events.length > 0 && visibleEvents.length === 0 && <p className="parent-empty">В этом разделе событий пока нет.</p>}
    {!loadingHistory && visibleEvents.length > 0 && <div className="history-list">{visibleEvents.map((event) => <article className="history-row" key={event.event_key}><div className="history-row-meta"><span>{historyCategoryLabels[event.category]}</span><time dateTime={event.occurred_on}>{formatHistoryDate(event.occurred_on)}</time></div><h3>{event.title}</h3>{event.detail && <p>{event.detail}</p>}<div className="history-row-status"><span>{historyStatusLabel(event)}</span>{event.stars !== null && <strong>{event.stars > 0 ? `+${event.stars}` : event.stars} ★</strong>}</div></article>)}</div>}
  </section>
}
