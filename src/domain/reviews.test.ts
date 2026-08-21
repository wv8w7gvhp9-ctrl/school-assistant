import { describe, expect, it } from 'vitest'
import { groupBackpackReviews, isMissingParentBookReviewsRpc, reviewAwardMessage, reviewCountLabel, reviewQueueRefreshIntervalMs, type BackpackReviewRow } from './reviews'

const row = (checklistId: string, itemId: string): BackpackReviewRow => ({
  checklist_id: checklistId,
  child_name: 'Ребёнок',
  target_day: '2026-09-01',
  status: 'pending_review',
  item_id: itemId,
  item_text: `Вещь ${itemId}`,
  checked: true,
})

describe('единая очередь родительской проверки', () => {
  it('объединяет вещи одного рюкзака в одно решение', () => {
    const result = groupBackpackReviews([row('one', 'a'), row('one', 'b'), row('two', 'c')])
    expect(result).toHaveLength(2)
    expect(result[0].items.map((item) => item.item_id)).toEqual(['a', 'b'])
  })

  it.each([[0, '0 решений'], [1, '1 решение'], [2, '2 решения'], [5, '5 решений'], [11, '11 решений'], [21, '21 решение']])(
    'правильно подписывает количество %i',
    (count, label) => expect(reviewCountLabel(count)).toBe(label),
  )

  it('показывает только фактически начисленные сервером звёзды', () => {
    expect(reviewAwardMessage('book', 3)).toBe('Книга подтверждена. Начислены три звезды.')
    expect(reviewAwardMessage('backpack', 1)).toBe('Рюкзак подтверждён. Начислена одна звезда.')
    expect(reviewAwardMessage('book', 0)).toContain('уже были начислены')
  })

  it('обновляет открытую очередь автоматически и использует старый запрос только до применения новой RPC', () => {
    expect(reviewQueueRefreshIntervalMs).toBeLessThanOrEqual(10_000)
    expect(isMissingParentBookReviewsRpc({ code: 'PGRST202' })).toBe(true)
    expect(isMissingParentBookReviewsRpc({ code: '42501', message: 'permission denied' })).toBe(false)
  })
})
