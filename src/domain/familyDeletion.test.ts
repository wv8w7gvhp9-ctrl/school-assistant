import { describe, expect, it } from 'vitest'
import { canDeleteFamily, familyDeletionConfirmation, normalizeFamilyDeletionConfirmation } from './familyDeletion'

describe('подтверждение удаления семейного профиля', () => {
  it('требует явное слово УДАЛИТЬ', () => {
    expect(familyDeletionConfirmation).toBe('УДАЛИТЬ')
    expect(canDeleteFamily('удалить')).toBe(true)
    expect(canDeleteFamily('  УДАЛИТЬ  ')).toBe(true)
  })

  it('не принимает пустой или похожий текст', () => {
    expect(canDeleteFamily('')).toBe(false)
    expect(canDeleteFamily('удали')).toBe(false)
    expect(canDeleteFamily('УДАЛИТЬ СЕМЬЮ')).toBe(false)
  })

  it('нормализует только регистр и внешние пробелы', () => {
    expect(normalizeFamilyDeletionConfirmation('  удалить  ')).toBe('УДАЛИТЬ')
    expect(normalizeFamilyDeletionConfirmation('уда лить')).toBe('УДА ЛИТЬ')
  })
})
