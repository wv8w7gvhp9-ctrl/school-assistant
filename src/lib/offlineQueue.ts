import { offlineMutationStore, openOfflineDatabase } from './offlineCache'

export type HomeworkSubmissionMutation = {
  id: string
  kind: 'submit_homework'
  childId: string
  homeworkId: string
  expectedUpdatedAt: string
  createdAt: string
  attempts: number
  lastError: string | null
}

export type HomeworkSyncOutcome = 'applied' | 'already_applied' | 'already_satisfied' | 'conflict' | 'missing' | 'retry'
export type HomeworkSyncResult = { mutation: HomeworkSubmissionMutation; outcome: HomeworkSyncOutcome; status: string | null; error?: string }

export const offlineQueueChangedEvent = 'school-assistant:offline-queue-changed'
export const offlineQueueSyncedEvent = 'school-assistant:offline-queue-synced'

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Offline queue transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Offline queue transaction was aborted'))
  })
}

export async function listHomeworkMutations(childId: string) {
  const database = await openOfflineDatabase()
  const transaction = database.transaction(offlineMutationStore, 'readonly')
  const request = transaction.objectStore(offlineMutationStore).getAll()
  const all = await new Promise<HomeworkSubmissionMutation[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as HomeworkSubmissionMutation[])
    request.onerror = () => reject(request.error ?? new Error('Offline queue could not be read'))
  })
  return all.filter((mutation) => mutation.kind === 'submit_homework' && mutation.childId === childId).sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

export async function enqueueHomeworkSubmission(childId: string, homeworkId: string, expectedUpdatedAt: string) {
  const existing = (await listHomeworkMutations(childId)).find((mutation) => mutation.homeworkId === homeworkId)
  if (existing) return existing
  const mutation: HomeworkSubmissionMutation = {
    id: crypto.randomUUID(),
    kind: 'submit_homework',
    childId,
    homeworkId,
    expectedUpdatedAt,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
  }
  const database = await openOfflineDatabase()
  const transaction = database.transaction(offlineMutationStore, 'readwrite')
  transaction.objectStore(offlineMutationStore).add(mutation)
  await transactionComplete(transaction)
  return mutation
}

export async function removeOfflineMutation(id: string) {
  const database = await openOfflineDatabase()
  const transaction = database.transaction(offlineMutationStore, 'readwrite')
  transaction.objectStore(offlineMutationStore).delete(id)
  await transactionComplete(transaction)
}

export async function markOfflineMutationFailed(mutation: HomeworkSubmissionMutation, error: string) {
  const database = await openOfflineDatabase()
  const transaction = database.transaction(offlineMutationStore, 'readwrite')
  transaction.objectStore(offlineMutationStore).put({ ...mutation, attempts: mutation.attempts + 1, lastError: error })
  await transactionComplete(transaction)
}

export function isTerminalHomeworkOutcome(outcome: HomeworkSyncOutcome) {
  return outcome !== 'retry'
}

export async function runHomeworkSync(
  mutations: HomeworkSubmissionMutation[],
  sync: (mutation: HomeworkSubmissionMutation) => Promise<Omit<HomeworkSyncResult, 'mutation'>>,
) {
  const results: HomeworkSyncResult[] = []
  for (const mutation of mutations) {
    try {
      results.push({ mutation, ...await sync(mutation) })
    } catch (error) {
      results.push({ mutation, outcome: 'retry', status: null, error: error instanceof Error ? error.message : 'Неизвестная ошибка синхронизации' })
    }
  }
  return results
}

export function notifyOfflineQueueChanged() {
  window.dispatchEvent(new Event(offlineQueueChangedEvent))
}
