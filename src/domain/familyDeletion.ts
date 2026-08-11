export const familyDeletionConfirmation = 'УДАЛИТЬ'

export function normalizeFamilyDeletionConfirmation(value: string) {
  return value.trim().toLocaleUpperCase('ru-RU')
}

export function canDeleteFamily(value: string) {
  return normalizeFamilyDeletionConfirmation(value) === familyDeletionConfirmation
}
