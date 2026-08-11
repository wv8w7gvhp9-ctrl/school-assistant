import { describe, expect, it } from 'vitest'
import { homeworkApprovalMessage, starAmountLabel, starTotal, validateStarCorrection, type StarEvent } from './stars'

const event = (stars: number): StarEvent => ({
  id: crypto.randomUUID(),
  source_type: 'adjustment',
  stars,
  reason: 'Техническая корректировка: проверка',
  created_at: '2026-08-11T08:00:00Z',
})

describe('история звёздочек', () => {
  it('считает начисления и корректировки как неизменяемые события', () => {
    expect(starTotal([event(3), event(1), event(-1)])).toBe(3)
  })

  it('показывает знак начисления и списания', () => {
    expect(starAmountLabel(3)).toBe('+3')
    expect(starAmountLabel(-2)).toBe('-2')
  })

  it('не разрешает нулевую, слишком большую и отрицательную сверх остатка корректировку', () => {
    expect(validateStarCorrection('0', 'Причина', 5)).toBeTruthy()
    expect(validateStarCorrection('51', 'Причина', 100)).toBeTruthy()
    expect(validateStarCorrection('-6', 'Причина', 5)).toBeTruthy()
    expect(validateStarCorrection('-2', 'Исправление дубля', 5)).toBeNull()
  })

  it('объясняет ежедневную дополнительную звезду после подтверждения', () => {
    expect(homeworkApprovalMessage(2)).toContain('за все задания дня вовремя')
    expect(homeworkApprovalMessage(1)).toContain('одна звезда')
  })
})
