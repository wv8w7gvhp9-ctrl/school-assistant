import { describe, expect, it } from 'vitest'
import { pullRefreshDistance, pullRefreshThreshold, shouldRefreshAfterPull } from './pullToRefresh'

describe('обновление детского экрана свайпом', () => {
  it('не реагирует на движение вверх или в сторону', () => {
    expect(pullRefreshDistance({ x: 20, y: 100 }, { x: 20, y: 70 })).toBe(0)
    expect(pullRefreshDistance({ x: 20, y: 100 }, { x: 120, y: 140 })).toBe(0)
  })

  it('показывает ограниченное расстояние при свайпе вниз', () => {
    expect(pullRefreshDistance({ x: 20, y: 100 }, { x: 24, y: 150 })).toBe(40)
    expect(pullRefreshDistance({ x: 20, y: 100 }, { x: 24, y: 500 })).toBe(96)
  })

  it('обновляет только после понятного порога', () => {
    expect(shouldRefreshAfterPull(pullRefreshThreshold - 1)).toBe(false)
    expect(shouldRefreshAfterPull(pullRefreshThreshold)).toBe(true)
  })
})
