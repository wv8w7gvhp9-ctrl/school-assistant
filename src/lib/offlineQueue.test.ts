import { describe, expect, it } from 'vitest'
import { isTerminalHomeworkOutcome, runHomeworkSync, type HomeworkSubmissionMutation } from './offlineQueue'

const mutation = (id: string): HomeworkSubmissionMutation => ({
  id,
  kind: 'submit_homework',
  childId: 'child',
  homeworkId: `homework-${id}`,
  expectedUpdatedAt: '2026-08-05T10:00:00.000Z',
  createdAt: '2026-08-05T10:01:00.000Z',
  attempts: 0,
  lastError: null,
})

describe('повторная синхронизация домашки', () => {
  it('обрабатывает действия последовательно', async () => {
    const order: string[] = []
    const results = await runHomeworkSync([mutation('a'), mutation('b')], async (item) => {
      order.push(item.id)
      return { outcome: 'applied', status: 'pending_review' }
    })
    expect(order).toEqual(['a', 'b'])
    expect(results.map((result) => result.outcome)).toEqual(['applied', 'applied'])
  })

  it('оставляет сетевую ошибку для повтора', async () => {
    const [result] = await runHomeworkSync([mutation('a')], async () => { throw new Error('network') })
    expect(result).toMatchObject({ outcome: 'retry', error: 'network' })
    expect(isTerminalHomeworkOutcome(result.outcome)).toBe(false)
  })

  it.each(['already_applied', 'already_satisfied', 'conflict', 'missing'] as const)('завершает очередь для результата %s', (outcome) => {
    expect(isTerminalHomeworkOutcome(outcome)).toBe(true)
  })
})
