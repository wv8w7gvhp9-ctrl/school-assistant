export type OfflineSnapshot<T> = { key: string; data: T; savedAt: string }

export type OfflineLoadResult<T> = {
  data: T | null
  error: unknown
  source: 'cloud' | 'cache' | 'none'
  savedAt: string | null
}

type RpcResponse<T> = { data: T | null; error: unknown }

const databaseName = 'school-assistant-offline'
const storeName = 'snapshots'
let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable'))
  if (databasePromise) return databasePromise
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened'))
  })
  return databasePromise
}

export async function readOfflineSnapshot<T>(key: string): Promise<OfflineSnapshot<T> | null> {
  try {
    const database = await openDatabase()
    return await new Promise((resolve, reject) => {
      const request = database.transaction(storeName, 'readonly').objectStore(storeName).get(key)
      request.onsuccess = () => resolve((request.result as OfflineSnapshot<T> | undefined) ?? null)
      request.onerror = () => reject(request.error ?? new Error('Offline snapshot could not be read'))
    })
  } catch (error) {
    console.warn('Не удалось прочитать офлайн-кэш', error)
    return null
  }
}

export async function saveOfflineSnapshot<T>(key: string, data: T, savedAt = new Date().toISOString()) {
  try {
    const database = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(storeName, 'readwrite').objectStore(storeName).put({ key, data, savedAt } satisfies OfflineSnapshot<T>)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error ?? new Error('Offline snapshot could not be saved'))
    })
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
  schedule: (childId: string, day: string) => `child:${childId}:schedule:${day}`,
  homework: (childId: string) => `child:${childId}:homework`,
  books: (childId: string) => `child:${childId}:books`,
  clubs: (childId: string) => `child:${childId}:clubs`,
  clubOccurrences: (childId: string, from: string, to: string) => `child:${childId}:club-occurrences:${from}:${to}`,
  backpack: (childId: string) => `child:${childId}:backpack`,
  stars: (childId: string) => `child:${childId}:stars`,
}

export function offlineSavedLabel(savedAt: string | null) {
  if (!savedAt) return ''
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short', timeZone: 'Europe/Samara' }).format(new Date(savedAt))
}
