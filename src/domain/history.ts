export type HistoryCategory = 'homework' | 'book' | 'backpack' | 'stars'

export type AcademicYearSummary = {
  id: string
  starts_on: string
  ends_on: string
  is_current: boolean
  is_completed: boolean
}

export type AcademicHistoryEvent = {
  event_key: string
  category: HistoryCategory
  occurred_on: string
  occurred_at: string
  title: string
  detail: string
  status: string
  stars: number | null
}

export type HistoryFilter = 'Все' | 'Домашка' | 'Книги' | 'Рюкзак' | 'Звёзды'

export const historyFilters: HistoryFilter[] = ['Все', 'Домашка', 'Книги', 'Рюкзак', 'Звёзды']

const categoryByFilter: Partial<Record<HistoryFilter, HistoryCategory>> = {
  Домашка: 'homework',
  Книги: 'book',
  Рюкзак: 'backpack',
  Звёзды: 'stars',
}

export const historyCategoryLabels: Record<HistoryCategory, string> = {
  homework: 'Домашка',
  book: 'Книга',
  backpack: 'Рюкзак',
  stars: 'Звёзды',
}

const statusLabels: Record<string, string> = {
  todo: 'Нужно выполнить',
  pending_review: 'Ждёт проверки',
  approved: 'Подтверждено',
  needs_revision: 'Нужно доделать',
  assigned: 'Нужно прочитать',
  reading: 'Читает',
  finished: 'Прочитано',
  not_submitted: 'Дневник не отправлен',
  packing: 'Собирается',
  homework: 'За домашку',
  book: 'За книгу',
  backpack: 'За рюкзак',
  homework_day: 'За выполненный день',
  adjustment: 'Корректировка',
}

export function historyStatusLabel(event: Pick<AcademicHistoryEvent, 'category' | 'status'>) {
  if (event.category === 'book') {
    const [bookStatus, reviewStatus] = event.status.split(':')
    if (reviewStatus === 'approved') return 'Прочитано и подтверждено'
    if (reviewStatus === 'pending_review') return 'Ждёт проверки'
    return statusLabels[bookStatus] ?? 'Книга'
  }
  return statusLabels[event.status] ?? event.status
}

export function filterAcademicHistory(events: AcademicHistoryEvent[], filter: HistoryFilter) {
  const category = categoryByFilter[filter]
  return category ? events.filter((event) => event.category === category) : events
}

function formatUtcDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
}

export function formatAcademicYear(year: Pick<AcademicYearSummary, 'starts_on' | 'ends_on'>) {
  return `${formatUtcDate(year.starts_on)} — ${formatUtcDate(year.ends_on)}`
}

export function formatHistoryDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
}

function safeSpreadsheetCell(value: string) {
  const normalized = value.replace(/\r\n/g, '\n')
  return /^[=+\-@]/.test(normalized.trimStart()) ? `'${normalized}` : normalized
}

function csvCell(value: string | number | null) {
  const safeValue = safeSpreadsheetCell(value === null ? '' : String(value))
  return `"${safeValue.replace(/"/g, '""')}"`
}

export function academicHistoryToCsv(events: AcademicHistoryEvent[]) {
  const header = ['Дата', 'Раздел', 'Название', 'Описание', 'Статус', 'Звёзды']
  const rows = events.map((event) => [
    formatUtcDate(event.occurred_on),
    historyCategoryLabels[event.category],
    event.title,
    event.detail,
    historyStatusLabel(event),
    event.stars,
  ])
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`
}

export function academicHistoryFilename(year: Pick<AcademicYearSummary, 'starts_on' | 'ends_on'>) {
  return `shkolny-pomoshchnik-istoriya-${year.starts_on}-${year.ends_on}.csv`
}
