import type { HomeworkStatus } from './types'

export type CloudHomeworkAssignment = {
  id: string
  subject_title: string
  due_on: string
  preferred_by: string | null
  task: string
  status: HomeworkStatus
}

export type HomeworkFilter = 'Сегодня' | 'На завтра' | 'Выполнено'

export type HomeworkDraft = {
  subject: string
  dueOn: string
  preferredBy: string
  task: string
}

export function samaraIsoDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Samara',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function filterHomework(assignments: CloudHomeworkAssignment[], filter: HomeworkFilter, today = samaraIsoDate()) {
  if (filter === 'Выполнено') return assignments.filter((assignment) => assignment.status === 'approved')
  const dueOn = filter === 'Сегодня' ? today : addDays(today, 1)
  return assignments.filter((assignment) => assignment.due_on === dueOn)
}

export function homeworkProgress(assignments: CloudHomeworkAssignment[]) {
  const complete = assignments.filter((assignment) => assignment.status === 'pending_review' || assignment.status === 'approved').length
  return { complete, total: assignments.length }
}

export function preferredTimeLabel(value: string | null) {
  return value ? `Желательно до ${value.slice(0, 5)}` : ''
}

export function validateHomeworkDraft(draft: HomeworkDraft) {
  if (!draft.subject.trim()) return 'Введите предмет.'
  if (!draft.dueOn) return 'Выберите дату выполнения.'
  if (!draft.task.trim()) return 'Напишите, что нужно сделать.'
  if (draft.task.trim().length > 2000) return 'Текст задания должен быть короче 2000 символов.'
  return null
}
