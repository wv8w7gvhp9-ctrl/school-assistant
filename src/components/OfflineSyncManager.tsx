import { useCallback, useEffect, useRef, useState } from 'react'
import type { CloudHomeworkAssignment } from '../domain/homework'
import { offlineKey, saveOfflineSnapshot } from '../lib/offlineCache'
import {
  isTerminalOfflineOutcome,
  listOfflineMutations,
  markOfflineMutationFailed,
  offlineQueueChangedEvent,
  offlineQueueSyncedEvent,
  removeOfflineMutation,
  runOfflineSync,
  type OfflineMutation,
  type OfflineSyncOutcome,
} from '../lib/offlineQueue'
import { supabase } from '../lib/supabase'
import { useChildSession } from './ChildSession'
import { useOnlineStatus } from './NetworkStatus'

type SyncNotice = { kind: 'syncing' | 'success' | 'warning' | 'error'; text: string } | null
const outcomes: OfflineSyncOutcome[] = ['applied', 'already_applied', 'already_satisfied', 'conflict', 'missing', 'not_ready', 'retry']

function confirmedOutcome(row: { status?: string | null; outcome?: OfflineSyncOutcome } | undefined) {
  if (!row?.outcome || !outcomes.includes(row.outcome)) {
    return { outcome: 'retry' as const, status: null, error: 'Сервер не подтвердил синхронизацию' }
  }
  return { outcome: row.outcome, status: row.status ?? null }
}

export function OfflineSyncManager() {
  const profile = useChildSession()
  const online = useOnlineStatus()
  const syncing = useRef(false)
  const rerunRequested = useRef(false)
  const noticeTimer = useRef<number | null>(null)
  const retryTimer = useRef<number | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [notice, setNotice] = useState<SyncNotice>(null)

  const clearRetryTimer = useCallback(() => {
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current)
    retryTimer.current = null
  }, [])

  const scheduleRetry = useCallback(() => {
    clearRetryTimer()
    retryTimer.current = window.setTimeout(() => {
      window.dispatchEvent(new Event(offlineQueueChangedEvent))
    }, 10_000)
  }, [clearRetryTimer])

  const showTemporaryNotice = useCallback((next: Exclude<SyncNotice, null>) => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    setNotice(next)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 6000)
  }, [])

  const refreshCount = useCallback(async () => {
    if (!profile) return []
    try {
      const mutations = await listOfflineMutations(profile.childId)
      setPendingCount(mutations.length)
      return mutations
    } catch (error) {
      console.error('Не удалось прочитать сохранённые действия', error)
      setPendingCount(0)
      setNotice({ kind: 'error', text: 'Не получилось открыть сохранённые действия на устройстве.' })
      return []
    }
  }, [profile])

  const syncMutation = useCallback(async (mutation: OfflineMutation) => {
    const client = supabase
    if (!client) return { outcome: 'retry' as const, status: null, error: 'Облако не настроено' }

    if (mutation.kind === 'submit_homework') {
      const { data, error } = await client.rpc('sync_my_homework_submission', {
        input_homework_id: mutation.homeworkId,
        input_mutation_id: mutation.id,
        input_expected_updated_at: mutation.expectedUpdatedAt,
      })
      if (error) return { outcome: 'retry' as const, status: null, error: error.message }
      return confirmedOutcome(data?.[0] as { status?: string | null; outcome?: OfflineSyncOutcome } | undefined)
    }

    if (mutation.kind === 'set_backpack_item') {
      const { data, error } = await client.rpc('sync_my_backpack_item', {
        input_item_id: mutation.itemId,
        input_mutation_id: mutation.id,
        input_checked: mutation.checked,
        input_expected_updated_at: mutation.expectedUpdatedAt,
      })
      if (error) return { outcome: 'retry' as const, status: null, error: error.message }
      return confirmedOutcome(data?.[0] as { outcome?: OfflineSyncOutcome } | undefined)
    }

    const { data, error } = await client.rpc('sync_my_backpack_submission', {
      input_checklist_id: mutation.checklistId,
      input_mutation_id: mutation.id,
      input_expected_updated_at: mutation.expectedUpdatedAt,
    })
    if (error) return { outcome: 'retry' as const, status: null, error: error.message }
    return confirmedOutcome(data?.[0] as { status?: string | null; outcome?: OfflineSyncOutcome } | undefined)
  }, [])

  const syncQueue = useCallback(async () => {
    const client = supabase
    if (!client || !profile || !online) return
    if (syncing.current) {
      rerunRequested.current = true
      return
    }

    syncing.current = true
    try {
      const mutations = await refreshCount()
      if (mutations.length === 0) {
        clearRetryTimer()
        return
      }

      setNotice({ kind: 'syncing', text: 'Отправляем сохранённые действия…' })
      const results = await runOfflineSync(mutations, syncMutation, true)

      for (const result of results) {
        if (isTerminalOfflineOutcome(result.outcome)) await removeOfflineMutation(result.mutation.id)
        else await markOfflineMutationFailed(result.mutation, result.error ?? 'Сетевая ошибка')
      }

      const homeworkChanged = results.some((result) => result.mutation.kind === 'submit_homework' && isTerminalOfflineOutcome(result.outcome))
      if (homeworkChanged) {
        const { data, error } = await client.rpc('get_my_homework_v2')
        if (error) console.error('Не удалось обновить домашку после синхронизации', error)
        else await saveOfflineSnapshot(offlineKey.homework(profile.childId), (data ?? []) as CloudHomeworkAssignment[])
      }

      const backpackChanged = results.some((result) => (result.mutation.kind === 'set_backpack_item' || result.mutation.kind === 'submit_backpack') && isTerminalOfflineOutcome(result.outcome))
      if (backpackChanged) {
        const { data, error } = await client.rpc('get_my_backpack_v2')
        if (error) console.error('Не удалось обновить рюкзак после синхронизации', error)
        else await saveOfflineSnapshot(offlineKey.backpack(profile.childId), data ?? [])
      }

      const remaining = await refreshCount()
      window.dispatchEvent(new CustomEvent(offlineQueueSyncedEvent, { detail: { childId: profile.childId, results } }))

      if (results.some((result) => result.outcome === 'conflict' || result.outcome === 'missing' || result.outcome === 'not_ready')) {
        showTemporaryNotice({ kind: 'warning', text: 'Данные изменились на другом устройстве. Открой раздел и проверь обновление.' })
      } else if (remaining.length > 0) {
        setNotice({ kind: 'error', text: 'Пока не удалось отправить действие. Повторим автоматически.' })
        scheduleRetry()
      } else {
        clearRetryTimer()
        showTemporaryNotice({ kind: 'success', text: 'Сохранённые действия отправлены.' })
      }
    } catch (error) {
      console.error('Не удалось обработать офлайн-очередь', error)
      setNotice({ kind: 'error', text: 'Пока не удалось отправить действие. Повторим автоматически.' })
      scheduleRetry()
    } finally {
      syncing.current = false
      if (rerunRequested.current) {
        rerunRequested.current = false
        window.setTimeout(() => window.dispatchEvent(new Event(offlineQueueChangedEvent)), 0)
      }
    }
  }, [clearRetryTimer, online, profile, refreshCount, scheduleRetry, showTemporaryNotice, syncMutation])

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
    clearRetryTimer()
  }, [clearRetryTimer])

  if (!notice && pendingCount === 0) return null
  const visibleNotice = notice ?? { kind: 'warning' as const, text: `${pendingCount} ${pendingCount === 1 ? 'действие ждёт' : 'действия ждут'} отправки.` }
  return <aside className={`sync-banner ${visibleNotice.kind}`} role={visibleNotice.kind === 'error' ? 'alert' : 'status'}>
    <strong>{visibleNotice.kind === 'syncing' ? 'Синхронизация' : visibleNotice.kind === 'success' ? 'Готово' : visibleNotice.kind === 'error' ? 'Не отправлено' : 'Ждёт отправки'}</strong>
    <span>{visibleNotice.text}</span>
  </aside>
}
