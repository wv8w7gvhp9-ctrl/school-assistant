import { describe, expect, it, vi } from 'vitest'
import { createPwaUpdateStore } from './pwaUpdate'

describe('обновление установленного приложения', () => {
  it('показывает готовность только после сигнала service worker', () => {
    const store = createPwaUpdateStore()

    expect(store.getSnapshot()).toBe(false)
    store.notifyReady()
    expect(store.getSnapshot()).toBe(true)
  })

  it('уведомляет интерфейс один раз и поддерживает отписку', () => {
    const store = createPwaUpdateStore()
    const activeListener = vi.fn()
    const removedListener = vi.fn()
    const unsubscribe = store.subscribe(removedListener)

    store.subscribe(activeListener)
    unsubscribe()
    store.notifyReady()
    store.notifyReady()

    expect(activeListener).toHaveBeenCalledTimes(1)
    expect(removedListener).not.toHaveBeenCalled()
  })

  it('проверяет и применяет ожидающее обновление через настроенные действия', async () => {
    const store = createPwaUpdateStore()
    const check = vi.fn()
    const apply = vi.fn()

    store.configureUpdateCheck(check)
    await store.checkForUpdate()
    store.notifyReady(apply)
    await store.applyUpdate()

    expect(check).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledTimes(1)
  })
})
