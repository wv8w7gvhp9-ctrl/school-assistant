export type CalendarPeriod = {
  label: string
  starts_on: string
  ends_on: string
  reason: 'vacation' | 'holiday' | 'weekend_override'
}

export type CalendarDocument = {
  url: string
  title: string
  documentNumber: string
  publishedOn: string
}

const months: Record<string, number> = {
  января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6,
  июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12,
}

export function htmlToText(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&#8470;|&numero;/gi, '№')
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/\s+/g, ' ')
    .trim()
}

export function findCalendarDocument(archiveHtml: string, academicStartYear: number): CalendarDocument | null {
  const expectedYear = `${academicStartYear}/${academicStartYear + 1}`
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  for (const match of archiveHtml.matchAll(anchorPattern)) {
    const title = htmlToText(match[2])
    if (!title.includes(expectedYear) || !/организац\S*\s+каникул/i.test(title)) continue
    const number = title.match(/(?:№|N)\s*([А-ЯA-ZЁ0-9/-]+)/i)?.[1] ?? ''
    const published = title.match(/(?:от\s+)?(\d{1,2})[.\s]+(\d{1,2})[.\s]+(\d{4})/)
    if (!number || !published) continue
    return {
      url: new URL(match[1], 'https://www.consultant.ru').toString(),
      title,
      documentNumber: number,
      publishedOn: `${published[3]}-${published[2].padStart(2, '0')}-${published[1].padStart(2, '0')}`,
    }
  }
  return null
}

function isoDate(day: string, monthName: string, year: string) {
  const month = months[monthName.toLowerCase()]
  if (!month) throw new Error(`Unknown Russian month: ${monthName}`)
  return `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`
}

function findPeriod(text: string, labelPattern: string, label: string): CalendarPeriod | null {
  const month = '(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)'
  const match = text.match(new RegExp(
    `${labelPattern}[\\s\\S]{0,180}?с\\s+(\\d{1,2})\\s+${month}(?:\\s+(\\d{4}))?[\\s\\S]{0,80}?по\\s+(\\d{1,2})\\s+${month}\\s+(\\d{4})`,
    'i',
  ))
  if (!match) return null
  const endYear = Number(match[6])
  const startMonth = months[match[2].toLowerCase()]
  const endMonth = months[match[5].toLowerCase()]
  const startYear = match[3] ? Number(match[3]) : endYear - (startMonth > endMonth ? 1 : 0)
  return {
    label,
    starts_on: isoDate(match[1], match[2], String(startYear)),
    ends_on: isoDate(match[4], match[5], String(endYear)),
    reason: 'vacation',
  }
}

export function extractRecommendedPeriods(documentHtml: string, academicStartYear: number): CalendarPeriod[] | null {
  const text = htmlToText(documentHtml)
  if (!text.includes(`${academicStartYear}/${academicStartYear + 1}`)) return null
  const periods = [
    findPeriod(text, 'осенние\\s+каникулы', 'Осенние каникулы'),
    findPeriod(text, 'зимние\\s+каникулы', 'Зимние каникулы'),
    findPeriod(text, 'весенние\\s+каникулы', 'Весенние каникулы'),
    findPeriod(text, 'летние\\s+каникулы', 'Летние каникулы'),
  ]
  if (periods.some((period) => period === null)) return null
  const result = periods as CalendarPeriod[]
  if (/праздничн\S*\s+дн\S*\s+4\s+ноября/i.test(text)) {
    result.splice(1, 0, {
      label: 'День народного единства',
      starts_on: `${academicStartYear}-11-04`,
      ends_on: `${academicStartYear}-11-04`,
      reason: 'holiday',
    })
  }
  return result
}
