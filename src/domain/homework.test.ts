import { describe, expect, it } from 'vitest'
import { addDays, filterHomework, homeworkProgress, preferredTimeLabel, samaraIsoDate, validateHomeworkDraft, type CloudHomeworkAssignment } from './homework'

const assignments: CloudHomeworkAssignment[] = [
  { id: '1', subject_title: 'Математика', due_on: '2026-08-05', preferred_by: null, task: '№ 4 и 5', status: 'todo' },
  { id: '2', subject_title: 'Русский язык', due_on: '2026-08-05', preferred_by: '18:30:00', task: 'Упражнение 18', status: 'pending_review' },
  { id: '3', subject_title: 'Чтение', due_on: '2026-08-06', preferred_by: null, task: 'Страницы 24–30', status: 'approved' },
]

describe('облачная домашка ребёнка', () => {
  it('вычисляет сегодняшнюю дату в часовом поясе Самары', () => {
    expect(samaraIsoDate(new Date('2026-08-04T21:30:00Z'))).toBe('2026-08-05')
  })

  it('вычисляет следующий календарный день без влияния часового пояса устройства', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
  })

  it('разделяет задания на сегодня, завтра и подтверждённые', () => {
    expect(filterHomework(assignments, 'Сегодня', '2026-08-05').map((item) => item.id)).toEqual(['1', '2'])
    expect(filterHomework(assignments, 'На завтра', '2026-08-05').map((item) => item.id)).toEqual(['3'])
    expect(filterHomework(assignments, 'Выполнено', '2026-08-05').map((item) => item.id)).toEqual(['3'])
  })

  it('считает отправленные на проверку задания выполненными ребёнком', () => {
    expect(homeworkProgress(assignments.slice(0, 2))).toEqual({ complete: 1, total: 2 })
  })

  it('показывает необязательное желательное время без секунд', () => {
    expect(preferredTimeLabel('18:30:00')).toBe('Желательно до 18:30')
    expect(preferredTimeLabel(null)).toBe('')
  })

  it('не разрешает сохранить домашку без обязательных полей', () => {
    expect(validateHomeworkDraft({ subject: '', dueOn: '2026-08-05', preferredBy: '', task: '№ 4' })).toBe('Введите предмет.')
    expect(validateHomeworkDraft({ subject: 'Математика', dueOn: '2026-08-05', preferredBy: '', task: '№ 4' })).toBeNull()
  })
})
