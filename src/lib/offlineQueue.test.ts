import { describe, expect, it } from 'vitest'
import { isTerminalOfflineOutcome, runOfflineSync, sortOfflineMutations, type OfflineMutation } from './offlineQueue'

const homeworkMutation = (id: string, createdAt = '2026-08-05T10:01:00.000Z'): OfflineMutation => ({
  id,
  kind: 'submit_homework',
  childId: 'child',
  homeworkId: `homework-${id}`,
  expectedUpdatedAt: '2026-08-05T10:00:00.000Z',
  createdAt,
  attempts: 0,
  lastError: null,
})

const backpackItemMutation = (id: string): OfflineMutation => ({
  id,
  kind: 'set_backpack_item',
  childId: 'child',
  checklistId: 'backpack',
  itemId: `item-${id}`,
  checked: true,
  expectedUpdatedAt: '2026-08-05T10:00:00.000Z',
  createdAt: '2026-08-05T10:02:00.000Z',
  attempts: 0,
  lastError: null,
})

const backpackSubmissionMutation = (): OfflineMutation => ({
  id: 'submit-backpack',
  kind: 'submit_backpack',
  childId: 'child',
  checklistId: 'backpack',
  expectedUpdatedAt: '2026-08-05T10:00:00.000Z',
  createdAt: '2026-08-05T10:02:00.000Z',
  attempts: 0,
  lastError: null,
})

describe('повторная синхронизация действий ребёнка', () => {
  it('обрабатывает действия последовательно', async () => {
    const order: string[] = []
    const results = await runOfflineSync([homeworkMutation('a'), homeworkMutation('b', '2026-08-05T10:02:00.000Z')], async (item) => {
      order.push(item.id)
      return { outcome: 'applied', status: 'pending_review' }
    })
    expect(order).toEqual(['a', 'b'])
    expect(results.map((result) => result.outcome)).toEqual(['applied', 'applied'])
  })

  it('отправляет отметки вещей раньше финальной отправки рюкзака', () => {
    const sorted = sortOfflineMutations([backpackSubmissionMutation(), backpackItemMutation('pencil')])
    expect(sorted.map((mutation) => mutation.kind)).toEqual(['set_backpack_item', 'submit_backpack'])
  })

  it('останавливает зависимую очередь после временной ошибки', async () => {
    const attempted: string[] = []
    const results = await runOfflineSync([backpackItemMutation('book'), backpackSubmissionMutation()], async (item) => {
      attempted.push(item.id)
      return { outcome: 'retry', status: null, error: 'network' }
    }, true)
    expect(attempted).toEqual(['book'])
    expect(results).toHaveLength(1)
  })

  it('оставляет сетевую ошибку для повтора', async () => {
    const [result] = await runOfflineSync([homeworkMutation('a')], async () => { throw new Error('network') })
    expect(result).toMatchObject({ outcome: 'retry', error: 'network' })
    expect(isTerminalOfflineOutcome(result.outcome)).toBe(false)
  })

  it.each(['already_applied', 'already_satisfied', 'conflict', 'missing', 'not_ready'] as const)('завершает очередь для результата %s', (outcome) => {
    expect(isTerminalOfflineOutcome(outcome)).toBe(true)
  })
})
