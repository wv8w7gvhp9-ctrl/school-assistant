export type OfflineSnapshot<T> = { key: string; data: T; savedAt: string }

export type OfflineLoadResult<T> = {
  data: T | null
  error: unknown
  source: 'cloud' | 'cache' | 'none'
  savedAt: string | null
}

type RpcResponse<T> = { data: T | null; error: unknown }

const databaseName = 'school-assistant-offline'
export const offlineSnapshotStore = 'snapshots'
export const offlineMutationStore = 'mutations'
let databasePromise: Promise<IDBDatabase> | null = null

function offlineTransactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Offline storage transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Offline storage transaction was aborted'))
  })
}

export function openOfflineDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable'))
  if (databasePromise) return databasePromise
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 2)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(offlineSnapshotStore)) request.result.createObjectStore(offlineSnapshotStore, { keyPath: 'key' })
      if (!request.result.objectStoreNames.contains(offlineMutationStore)) request.result.createObjectStore(offlineMutationStore, { keyPath: 'id' })
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close()
        databasePromise = null
      }
      resolve(request.result)
    }
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened'))
  })
  return databasePromise
}

export async function readOfflineRecord<T>(key: string): Promise<OfflineSnapshot<T> | null> {
  const database = await openOfflineDatabase()
  return await new Promise((resolve, reject) => {
    const request = database.transaction(offlineSnapshotStore, 'readonly').objectStore(offlineSnapshotStore).get(key)
    request.onsuccess = () => resolve((request.result as OfflineSnapshot<T> | undefined) ?? null)
    request.onerror = () => reject(request.error ?? new Error('Offline snapshot could not be read'))
  })
}

export async function writeOfflineRecord<T>(key: string, data: T, savedAt = new Date().toISOString()) {
  const database = await openOfflineDatabase()
  const transaction = database.transaction(offlineSnapshotStore, 'readwrite')
  transaction.objectStore(offlineSnapshotStore).put({ key, data, savedAt } satisfies OfflineSnapshot<T>)
  await offlineTransactionComplete(transaction)
}

export async function deleteOfflineRecord(key: string) {
  const database = await openOfflineDatabase()
  const transaction = database.transaction(offlineSnapshotStore, 'readwrite')
  transaction.objectStore(offlineSnapshotStore).delete(key)
  await offlineTransactionComplete(transaction)
}

export function isOfflineRecordForChild(record: unknown, childId: string) {
  if (!record || typeof record !== 'object') return false
  const candidate = record as { key?: unknown; childId?: unknown }
  return candidate.childId === childId || (typeof candidate.key === 'string' && candidate.key.startsWith(`child:${childId}:`))
}

export async function clearOfflineDataForChild(childId: string) {
  const database = await openOfflineDatabase()
  const transaction = database.transaction([offlineSnapshotStore, offlineMutationStore], 'readwrite')
  for (const storeName of [offlineSnapshotStore, offlineMutationStore]) {
    const store = transaction.objectStore(storeName)
    const request = store.openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      if (isOfflineRecordForChild(cursor.value, childId)) cursor.delete()
      cursor.continue()
    }
  }
  await offlineTransactionComplete(transaction)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('school-assistant:offline-queue-changed'))
}

export async function readOfflineSnapshot<T>(key: string): Promise<OfflineSnapshot<T> | null> {
  try {
    return await readOfflineRecord<T>(key)
  } catch (error) {
    console.warn('Не удалось прочитать офлайн-кэш', error)
    return null
  }
}

export async function saveOfflineSnapshot<T>(key: string, data: T, savedAt = new Date().toISOString()) {
  try {
    await writeOfflineRecord(key, data, savedAt)
  } catch (error) {
    console.warn('Не удалось сохранить офлайн-кэш', error)
  }
}

export async function loadWithOfflineFallback<T>(
  key: string,
  request: () => PromiseLike<RpcResponse<T>>,
  online = typeof navigator === 'undefined' ? true : navigator.onLine,
  readSnapshot: typeof readOfflineSnapshot = readOfflineSnapshot,
  saveSnapshot: typeof saveOfflineSnapshot = saveOfflineSnapshot,
): Promise<OfflineLoadResult<T>> {
  let cloudError: unknown = null
  if (online) {
    try {
      const response = await request()
      if (!response.error) {
        const savedAt = new Date().toISOString()
        if (response.data !== null) await saveSnapshot(key, response.data, savedAt)
        return { data: response.data, error: null, source: 'cloud', savedAt }
      }
      cloudError = response.error
    } catch (error) {
      cloudError = error
    }
  }
  const cached = await readSnapshot<T>(key)
  if (cached) return { data: cached.data, error: cloudError, source: 'cache', savedAt: cached.savedAt }
  return { data: null, error: cloudError ?? new Error('No saved offline data'), source: 'none', savedAt: null }
}

export const offlineKey = {
  childProfile: (sessionUserId: string) => `session:${sessionUserId}:child-profile`,
  scheduleAcademicYear: (childId: string) => `child:${childId}:schedule-academic-year`,
  schedule: (childId: string, day: string) => `child:${childId}:schedule:${day}`,
  schoolDayStatus: (childId: string, day: string) => `child:${childId}:school-day-status:${day}`,
  homework: (childId: string) => `child:${childId}:homework`,
  books: (childId: string) => `child:${childId}:books`,
  readingDiaryDraft: (childId: string, bookId: string) => `child:${childId}:reading-diary-draft:${bookId}`,
  clubs: (childId: string) => `child:${childId}:clubs`,
  clubOccurrences: (childId: string, from: string, to: string) => `child:${childId}:club-occurrences:${from}:${to}`,
  backpack: (childId: string) => `child:${childId}:backpack`,
  stars: (childId: string) => `child:${childId}:stars`,
  starHistory: (childId: string) => `child:${childId}:star-history`,
}

export function offlineSavedLabel(savedAt: string | null) {
  if (!savedAt) return ''
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short', timeZone: 'Europe/Samara' }).format(new Date(savedAt))
}
