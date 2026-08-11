export type SchoolCalendarPeriod = {
  label: string
  starts_on: string
  ends_on: string
  reason: 'vacation' | 'holiday' | 'weekend_override'
}

export type SchoolCalendarProposal = {
  id: string
  status: 'pending' | 'approved' | 'rejected'
  document_title: string
  document_number: string
  published_on: string
  source_url: string
  official_index_url: string
  periods: SchoolCalendarPeriod[]
  created_at: string
  reviewed_at: string | null
}

function localDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
})

export function formatCalendarPeriod(period: SchoolCalendarPeriod) {
  const start = dateFormatter.format(localDate(period.starts_on))
  if (period.starts_on === period.ends_on) return start
  return `${start} — ${dateFormatter.format(localDate(period.ends_on))}`
}

export function academicYearLabel(startsOn: string) {
  const year = Number(startsOn.slice(0, 4))
  return `${year}–${year + 1}`
}

export function isCalendarProposal(value: unknown): value is SchoolCalendarProposal {
  if (!value || typeof value !== 'object') return false
  const proposal = value as Partial<SchoolCalendarProposal>
  const isoDate = /^\d{4}-\d{2}-\d{2}$/
  return typeof proposal.id === 'string'
    && ['pending', 'approved', 'rejected'].includes(proposal.status ?? '')
    && typeof proposal.document_title === 'string'
    && typeof proposal.document_number === 'string'
    && typeof proposal.published_on === 'string'
    && isoDate.test(proposal.published_on)
    && typeof proposal.source_url === 'string'
    && proposal.source_url.startsWith('https://')
    && typeof proposal.official_index_url === 'string'
    && proposal.official_index_url.startsWith('https://')
    && typeof proposal.created_at === 'string'
    && (proposal.reviewed_at === null || typeof proposal.reviewed_at === 'string')
    && Array.isArray(proposal.periods)
    && proposal.periods.every((period) => Boolean(
      period?.label
      && isoDate.test(period.starts_on)
      && isoDate.test(period.ends_on)
      && ['vacation', 'holiday', 'weekend_override'].includes(period.reason),
    ))
}
