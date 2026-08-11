import { describe, expect, it } from 'vitest'
import { extractRecommendedPeriods, findCalendarDocument, htmlToText } from './parser'

describe('разбор официального календаря', () => {
  it('находит документ нужного учебного года в архиве КонсультантПлюс', () => {
    const result = findCalendarDocument(`
      <a href="/document/cons_doc_LAW_538951/">Письмо Минпросвещения России от 07.07.2026 № ОК-1948/03
      О направлении рекомендаций по организации каникул в 2026/2027 учебном году</a>
    `, 2026)
    expect(result?.url).toBe('https://www.consultant.ru/document/cons_doc_LAW_538951/')
    expect(result?.documentNumber).toBe('ОК-1948/03')
  })

  it('извлекает только общие каникулы и не добавляет каникулы первого класса', () => {
    const result = extractRecommendedPeriods(`
      Рекомендации в 2026/2027 учебном году при системе обучения по четвертям:
      осенние каникулы: с 26 октября по 3 ноября 2026 г. с учетом праздничного дня 4 ноября;
      зимние каникулы: с 31 декабря 2026 г. по 10 января 2027 г.;
      весенние каникулы: с 27 марта по 4 апреля 2027 г.;
      летние каникулы: с 27 мая по 31 августа 2027 г.
      Для первого класса с 15 по 21 февраля 2027 г.
    `, 2026)
    expect(result).toHaveLength(5)
    expect(result?.[0]).toMatchObject({ starts_on: '2026-10-26', ends_on: '2026-11-03' })
    expect(result?.some((period) => period.starts_on === '2027-02-15')).toBe(false)
  })

  it('не принимает страницу без всех четырёх общих периодов', () => {
    expect(extractRecommendedPeriods('Каникулы 2026/2027: осенние каникулы с 1 сентября 2026 по 2 сентября 2026', 2026)).toBeNull()
  })

  it('очищает разметку и HTML-сущности', () => {
    expect(htmlToText('<p>Каникулы&nbsp;&amp; отдых</p>')).toBe('Каникулы & отдых')
  })
})
