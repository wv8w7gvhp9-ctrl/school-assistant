export type StarEvent = {
  id: string
  source_type: 'homework' | 'book' | 'backpack' | 'homework_day' | 'adjustment'
  stars: number
  reason: string
  created_at: string
}

export function starTotal(events: StarEvent[]) {
  return events.reduce((total, event) => total + event.stars, 0)
}

export function starAmountLabel(value: number) {
  return value > 0 ? `+${value}` : `${value}`
}

export function formatStarEventDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Samara',
  }).format(new Date(value))
}

export function validateStarCorrection(amount: string, reason: string, currentTotal: number) {
  if (!/^-?\d+$/.test(amount.trim())) return 'Укажите целое количество звёзд.'
  const value = Number(amount)
  if (value === 0 || Math.abs(value) > 50) return 'Корректировка должна быть от −50 до 50 и не равна нулю.'
  if (currentTotal + value < 0) return 'После корректировки счётчик не может быть меньше нуля.'
  const normalizedReason = reason.trim()
  if (normalizedReason.length < 3) return 'Коротко укажите причину корректировки.'
  if (normalizedReason.length > 200) return 'Причина должна быть не длиннее 200 символов.'
  return null
}

export function homeworkApprovalMessage(starsAwarded: number) {
  if (starsAwarded === 2) return 'Задание подтверждено. Начислены 2 звезды: за задание и за все задания дня вовремя.'
  if (starsAwarded === 1) return 'Задание подтверждено. Начислена одна звезда.'
  return 'Задание подтверждено. Звезда за это основание уже была начислена.'
}
