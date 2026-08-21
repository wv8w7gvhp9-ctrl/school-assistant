import { describe, expect, it } from 'vitest'
import { isOfflineRecordForChild, isOfflineRecordForParent, loadWithOfflineFallback, offlineKey, offlineSavedLabel, type OfflineSnapshot } from './offlineCache'

describe('ключи офлайн-снимков', () => {
  it('отделяют снимки и очередь удаляемого ребёнка от чужих данных', () => {
    expect(isOfflineRecordForChild({ key: 'child:child-a:homework' }, 'child-a')).toBe(true)
    expect(isOfflineRecordForChild({ childId: 'child-a', kind: 'submit_homework' }, 'child-a')).toBe(true)
    expect(isOfflineRecordForChild({ key: 'child:child-b:homework' }, 'child-a')).toBe(false)
    expect(isOfflineRecordForChild({ key: 'session:device-a:child-profile' }, 'child-a')).toBe(false)
  })

  it('изолируют данные разных детей', () => {
    expect(offlineKey.homework('child-a')).not.toBe(offlineKey.homework('child-b'))
  })

  it('изолируют профиль ребёнка по сессии устройства', () => {
    expect(offlineKey.childProfile('device-a')).not.toBe(offlineKey.childProfile('device-b'))
  })

  it('изолируют родительский профиль и очередь по сессии и семье', () => {
    expect(offlineKey.parentFamily('parent-a')).not.toBe(offlineKey.parentFamily('parent-b'))
    expect(offlineKey.parentReviewQueue('parent-a', 'family-a')).not.toBe(offlineKey.parentReviewQueue('parent-a', 'family-b'))
    expect(isOfflineRecordForParent({ key: offlineKey.parentReviewQueue('parent-a', 'family-a') }, 'parent-a')).toBe(true)
    expect(isOfflineRecordForParent({ key: offlineKey.parentReviewQueue('parent-b', 'family-a') }, 'parent-a')).toBe(false)
  })

  it('изолируют историю звёзд разных детей', () => {
    expect(offlineKey.starHistory('child-a')).not.toBe(offlineKey.starHistory('child-b'))
  })

  it('изолируют расписание по фактической дате', () => {
    expect(offlineKey.schedule('child', '2026-08-05')).not.toBe(offlineKey.schedule('child', '2026-08-06'))
  })

  it('изолируют черновики разных книг и детей', () => {
    expect(offlineKey.readingDiaryDraft('child-a', 'book')).not.toBe(offlineKey.readingDiaryDraft('child-b', 'book'))
    expect(offlineKey.readingDiaryDraft('child-a', 'book-1')).not.toBe(offlineKey.readingDiaryDraft('child-a', 'book-2'))
  })

  it('показывают время последней синхронизации в Самаре', () => {
    expect(offlineSavedLabel('2026-08-05T08:30:00.000Z')).toMatch(/12:30/)
  })
})

describe('загрузка при нестабильной сети', () => {
  const noCache = async <T,>(_key: string): Promise<OfflineSnapshot<T> | null> => null
  const noSave = async <T,>(_key: string, _data: T, _savedAt?: string) => undefined

  it('сохраняет успешный ответ облака', async () => {
    let saved: string[] | null = null
    const save = async <T,>(_key: string, data: T) => { saved = data as string[] }
    const result = await loadWithOfflineFallback('key', async () => ({ data: ['урок'], error: null }), true, noCache, save)
    expect(result.source).toBe('cloud')
    expect(saved).toEqual(['урок'])
  })

  it('не делает сетевой запрос без интернета и читает снимок', async () => {
    let requested = false
    const read = async <T,>(_key: string) => ({ key: 'key', data: ['книга'] as T, savedAt: '2026-08-05T08:30:00.000Z' })
    const result = await loadWithOfflineFallback('key', async () => { requested = true; return { data: [], error: null } }, false, read, noSave)
    expect(requested).toBe(false)
    expect(result).toMatchObject({ source: 'cache', data: ['книга'] })
  })

  it('использует снимок после сетевой ошибки', async () => {
    const read = async <T,>(_key: string) => ({ key: 'key', data: ['кружок'] as T, savedAt: '2026-08-05T08:30:00.000Z' })
    const result = await loadWithOfflineFallback('key', async () => ({ data: null, error: new Error('network') }), true, read, noSave)
    expect(result).toMatchObject({ source: 'cache', data: ['кружок'] })
  })

  it('честно сообщает об отсутствии сохранённых данных', async () => {
    const result = await loadWithOfflineFallback('key', async () => ({ data: [], error: null }), false, noCache, noSave)
    expect(result.source).toBe('none')
    expect(result.data).toBeNull()
  })
})
