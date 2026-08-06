import { offlineMutationStore, openOfflineDatabase } from './offlineCache'
import type { ReadingDiaryDraft } from '../domain/books'

type OfflineMutationBase = {
  id: string
  childId: string
  createdAt: string
  attempts: number
  lastError: string | null
}

export type HomeworkSubmissionMutation = OfflineMutationBase & {
  kind: 'submit_homework'
  homeworkId: string
  expectedUpdatedAt: string
}

export type BackpackItemMutation = OfflineMutationBase & {
  kind: 'set_backpack_item'
  checklistId: string
  itemId: string
  checked: boolean
  expectedUpdatedAt: string
}

export type BackpackSubmissionMutation = OfflineMutationBase & {
  kind: 'submit_backpack'
  checklistId: string
  expectedUpdatedAt: string
}

export type ReadingDiaryMutation = OfflineMutationBase & {
  kind: 'save_reading_diary'
  bookId: string
  expectedUpdatedAt: string
  draft: ReadingDiaryDraft
}

export type OfflineMutation = HomeworkSubmissionMutation | BackpackItemMutation | BackpackSubmissionMutation | ReadingDiaryMutation
export type OfflineSyncOutcome = 'applied' | 'already_applied' | 'already_satisfied' | 'conflict' | 'missing' | 'not_ready' | 'retry'
export type OfflineSyncResult = { mutation: OfflineMutation; outcome: OfflineSyncOutcome; status: string | null; error?: string }

export const offlineQueueChangedEvent = 'school-assistant:offline-queue-changed'
export const offlineQueueSyncedEvent = 'school-assistant:offline-queue-synced'

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Offline queue transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Offline queue transaction was aborted'))
  })
}

function createMutationBase(childId: string): OfflineMutationBase {
  return {
    id: crypto.randomUUID(),
    childId,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
  }
}

function mutationPriority(mutation: OfflineMutation) {
  return mutation.kind === 'submit_backpack' ? 1 : 0
}

export function sortOfflineMutations(mutations: OfflineMutation[]) {
  return [...mutations].sort((left, right) => {
    const timeOrder = left.createdAt.localeCompare(right.createdAt)
    if (timeOrder !== 0) return timeOrder
    return mutationPriority(left) - mutationPriority(right)
  })
}

async function readAllOfflineMutations() {
  const database = await openOfflineDatabase()
  const transaction = database.transaction(offlineMutationStore, 'readonly')
  const request = transaction.objectStore(offlineMutationStore).getAll()
  return await new Promise<OfflineMutation[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as OfflineMutation[])
    request.onerror = () => reject(request.error ?? new Error('Offline queue could not be read'))
  })
}

async function putOfflineMutation(mutation: OfflineMutation) {
  const database = await openOfflineDatabase()
  const transaction = database.transaction(offlineMutationStore, 'readwrite')
  transaction.objectStore(offlineMutationStore).put(mutation)
  await transactionComplete(transaction)
  return mutation
}

export async function listOfflineMutations(childId: string) {
  return sortOfflineMutations((await readAllOfflineMutations()).filter((mutation) => mutation.childId === childId))
}

export async function listHomeworkMutations(childId: string) {
  return (await listOfflineMutations(childId)).filter((mutation): mutation is HomeworkSubmissionMutation => mutation.kind === 'submit_homework')
}

export async function listBackpackMutations(childId: string) {
  return (await listOfflineMutations(childId)).filter((mutation): mutation is BackpackItemMutation | BackpackSubmissionMutation => mutation.kind === 'set_backpack_item' || mutation.kind === 'submit_backpack')
}

export async function listReadingDiaryMutations(childId: string) {
  return (await listOfflineMutations(childId)).filter((mutation): mutation is ReadingDiaryMutation => mutation.kind === 'save_reading_diary')
}

export async function enqueueHomeworkSubmission(childId: string, homeworkId: string, expectedUpdatedAt: string) {
  const existing = (await listHomeworkMutations(childId)).find((mutation) => mutation.homeworkId === homeworkId)
  if (existing) return existing
  return putOfflineMutation({
    ...createMutationBase(childId),
    kind: 'submit_homework',
    homeworkId,
    expectedUpdatedAt,
  })
}

export async function enqueueBackpackItem(
  childId: string,
  checklistId: string,
  itemId: string,
  checked: boolean,
  expectedUpdatedAt: string,
) {
  const existing = (await listBackpackMutations(childId)).find((mutation): mutation is BackpackItemMutation => mutation.kind === 'set_backpack_item' && mutation.itemId === itemId)
  if (existing) return putOfflineMutation({ ...existing, checked, attempts: 0, lastError: null })
  return putOfflineMutation({
    ...createMutationBase(childId),
    kind: 'set_backpack_item',
    checklistId,
    itemId,
    checked,
    expectedUpdatedAt,
  })
}

export async function enqueueBackpackSubmission(childId: string, checklistId: string, expectedUpdatedAt: string) {
  const existing = (await listBackpackMutations(childId)).find((mutation): mutation is BackpackSubmissionMutation => mutation.kind === 'submit_backpack' && mutation.checklistId === checklistId)
  if (existing) return existing
  return putOfflineMutation({
    ...createMutationBase(childId),
    kind: 'submit_backpack',
    checklistId,
    expectedUpdatedAt,
  })
}

export async function enqueueReadingDiary(
  childId: string,
  bookId: string,
  expectedUpdatedAt: string,
  draft: ReadingDiaryDraft,
) {
  const existing = (await listReadingDiaryMutations(childId)).find((mutation) => mutation.bookId === bookId)
  if (existing) return putOfflineMutation({ ...existing, draft, attempts: 0, lastError: null })
  return putOfflineMutation({
    ...createMutationBase(childId),
    kind: 'save_reading_diary',
    bookId,
    expectedUpdatedAt,
    draft,
  })
}

export async function removeOfflineMutation(id: string) {
  const database = await openOfflineDatabase()
  const transaction = database.transaction(offlineMutationStore, 'readwrite')
  transaction.objectStore(offlineMutationStore).delete(id)
  await transactionComplete(transaction)
}

export async function markOfflineMutationFailed(mutation: OfflineMutation, error: string) {
  await putOfflineMutation({ ...mutation, attempts: mutation.attempts + 1, lastError: error })
}

export function isTerminalOfflineOutcome(outcome: OfflineSyncOutcome) {
  return outcome !== 'retry'
}

export async function runOfflineSync(
  mutations: OfflineMutation[],
  sync: (mutation: OfflineMutation) => Promise<Omit<OfflineSyncResult, 'mutation'>>,
  stopOnRetry = false,
) {
  const results: OfflineSyncResult[] = []
  for (const mutation of sortOfflineMutations(mutations)) {
    let result: OfflineSyncResult
    try {
      result = { mutation, ...await sync(mutation) }
    } catch (error) {
      result = { mutation, outcome: 'retry', status: null, error: error instanceof Error ? error.message : 'Неизвестная ошибка синхронизации' }
    }
    results.push(result)
    if (stopOnRetry && result.outcome === 'retry') break
  }
  return results
}

export function notifyOfflineQueueChanged() {
  window.dispatchEvent(new Event(offlineQueueChangedEvent))
}
