import type { CloudLesson } from './childSchedule'
import type { ClubOccurrence } from './clubs'
import type { CloudHomeworkAssignment } from './homework'

export type BackpackStatus = 'packing' | 'pending_review' | 'approved'

export type BackpackItem = {
  checklist_id: string
  target_day: string
  status: BackpackStatus
  item_id: string
  item_text: string
  subject_titles: string[]
  checked: boolean
}

export function activeTodayLessons(lessons: CloudLesson[]) {
  return lessons.filter((lesson) => lesson.status !== 'cancelled')
}

export function actionableTodayHomework(assignments: CloudHomeworkAssignment[], today: string) {
  return assignments.filter((assignment) => assignment.due_on === today && (assignment.status === 'todo' || assignment.status === 'needs_revision'))
}

export function activeTodayClubs(occurrences: ClubOccurrence[]) {
  return occurrences.filter((occurrence) => occurrence.status === 'regular' || occurrence.status === 'rescheduled')
}

export function backpackProgress(items: BackpackItem[]) {
  return { checked: items.filter((item) => item.checked).length, total: items.length }
}

export function formatFullRussianDate(isoDate: string) {
  const value = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Samara',
  }).format(new Date(`${isoDate}T12:00:00+04:00`))
  return value.charAt(0).toUpperCase() + value.slice(1)
}
