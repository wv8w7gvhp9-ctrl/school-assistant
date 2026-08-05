import { describe, expect, it } from 'vitest'
import { loadWithOfflineFallback, offlineKey, offlineSavedLabel, type OfflineSnapshot } from './offlineCache'

describe('ключи офлайн-снимков', () => {
  it('изолируют данные разных детей', () => {
    expect(offlineKey.homework('child-a')).not.toBe(offlineKey.homework('child-b'))
  })

  it('изолируют расписание по фактической дате', () => {
    expect(offlineKey.schedule('child', '2026-08-05')).not.toBe(offlineKey.schedule('child', '2026-08-06'))
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
