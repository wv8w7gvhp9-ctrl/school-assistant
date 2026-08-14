import { describe, expect, it } from 'vitest'
import { childTabFromSearch, searchForChildTab } from './navigation'

describe('навигация ребёнка из уведомления', () => {
  it('открывает вкладку домашки из безопасного параметра', () => {
    expect(childTabFromSearch('?tab=homework')).toBe('homework')
  })

  it('не принимает неизвестную вкладку', () => {
    expect(childTabFromSearch('?tab=admin')).toBe('today')
  })

  it('сохраняет посторонние параметры и убирает today из адреса', () => {
    expect(searchForChildTab('?source=push', 'homework')).toBe('?source=push&tab=homework')
    expect(searchForChildTab('?source=push&tab=homework', 'today')).toBe('?source=push')
  })
})
