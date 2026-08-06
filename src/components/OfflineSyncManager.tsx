import { useCallback, useEffect, useRef, useState } from 'react'
import { offlineKey, saveOfflineSnapshot } from '../lib/offlineCache'
import {
  isTerminalHomeworkOutcome,
  listHomeworkMutations,
  markOfflineMutationFailed,
  offlineQueueChangedEvent,
  offlineQueueSyncedEvent,
  removeOfflineMutation,
  runHomeworkSync,
  type HomeworkSyncOutcome,
} from '../lib/offlineQueue'
import { supabase } from '../lib/supabase'
import type { CloudHomeworkAssignment } from '../domain/homework'
import { useChildSession } from './ChildSession'
import { useOnlineStatus } from './NetworkStatus'

type SyncNotice = { kind: 'syncing' | 'success' | 'warning' | 'error'; text: string } | null
const outcomes: HomeworkSyncOutcome[] = ['applied', 'already_applied', 'already_satisfied', 'conflict', 'missing', 'retry']

export function OfflineSyncManager() {
  const profile = useChildSession()
  const online = useOnlineStatus()
  const syncing = useRef(false)
  const noticeTimer = useRef<number | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [notice, setNotice] = useState<SyncNotice>(null)

  const showTemporaryNotice = useCallback((next: Exclude<SyncNotice, null>) => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    setNotice(next)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 6000)
  }, [])

  const refreshCount = useCallback(async () => {
    if (!profile) return []
    const mutations = await listHomeworkMutations(profile.childId)
    setPendingCount(mutations.length)
    return mutations
  }, [profile])

  const syncQueue = useCallback(async () => {
    const client = supabase
    if (!client || !profile || !online || syncing.current) return
    syncing.current = true
    try {
      const mutations = await refreshCount()
      if (mutations.length === 0) return
      setNotice({ kind: 'syncing', text: 'Отправляем сохранённые действия…' })
      const results = await runHomeworkSync(mutations, async (mutation) => {
        const { data, error } = await client.rpc('sync_my_homework_submission', {
          input_homework_id: mutation.homeworkId,
          input_mutation_id: mutation.id,
          input_expected_updated_at: mutation.expectedUpdatedAt,
        })
        if (error) return { outcome: 'retry' as const, status: null, error: error.message }
        const row = data?.[0] as { status?: string | null; outcome?: HomeworkSyncOutcome } | undefined
        if (!row?.outcome || !outcomes.includes(row.outcome)) return { outcome: 'retry' as const, status: null, error: 'Сервер не подтвердил синхронизацию' }
        return { outcome: row.outcome, status: row.status ?? null }
      })

      for (const result of results) {
        if (isTerminalHomeworkOutcome(result.outcome)) await removeOfflineMutation(result.mutation.id)
        else await markOfflineMutationFailed(result.mutation, result.error ?? 'Сетевая ошибка')
      }

      const terminalResults = results.filter((result) => isTerminalHomeworkOutcome(result.outcome))
      if (terminalResults.length > 0) {
        const { data, error } = await client.rpc('get_my_homework_v2')
        if (!error) await saveOfflineSnapshot(offlineKey.homework(profile.childId), (data ?? []) as CloudHomeworkAssignment[])
      }

      const remaining = await refreshCount()
      window.dispatchEvent(new CustomEvent(offlineQueueSyncedEvent, { detail: { childId: profile.childId, results } }))
      if (results.some((result) => result.outcome === 'conflict' || result.outcome === 'missing')) {
        showTemporaryNotice({ kind: 'warning', text: 'Задание изменилось у родителя. Открой «Домашку» и проверь обновление.' })
      } else if (remaining.length > 0) {
        setNotice({ kind: 'error', text: 'Пока не удалось отправить действие. Повторим при следующем подключении.' })
      } else {
        showTemporaryNotice({ kind: 'success', text: 'Сохранённые действия отправлены.' })
      }
    } catch (error) {
      console.error('Не удалось обработать офлайн-очередь', error)
      setNotice({ kind: 'error', text: 'Пока не удалось отправить действие. Повторим при следующем подключении.' })
    } finally {
      syncing.current = false
    }
  }, [online, profile, refreshCount, showTemporaryNotice])

  useEffect(() => {
    const handleQueueChange = () => { if (online) void syncQueue(); else void refreshCount() }
    window.addEventListener(offlineQueueChangedEvent, handleQueueChange)
    return () => window.removeEventListener(offlineQueueChangedEvent, handleQueueChange)
  }, [online, refreshCount, syncQueue])

  useEffect(() => {
    if (online) void syncQueue()
    else void refreshCount()
  }, [online, refreshCount, syncQueue])

  useEffect(() => () => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
  }, [])

  if (!notice && pendingCount === 0) return null
  const visibleNotice = notice ?? { kind: 'warning' as const, text: `${pendingCount} ${pendingCount === 1 ? 'действие ждёт' : 'действия ждут'} отправки.` }
  return <aside className={`sync-banner ${visibleNotice.kind}`} role={visibleNotice.kind === 'error' ? 'alert' : 'status'}>
    <strong>{visibleNotice.kind === 'syncing' ? 'Синхронизация' : visibleNotice.kind === 'success' ? 'Готово' : visibleNotice.kind === 'error' ? 'Не отправлено' : 'Ждёт отправки'}</strong>
    <span>{visibleNotice.text}</span>
  </aside>
}
