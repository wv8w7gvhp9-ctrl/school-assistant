export type ChildTab = 'today' | 'schedule' | 'homework' | 'books' | 'clubs'
export type HomeworkStatus = 'todo' | 'pending_review' | 'approved' | 'needs_revision'

export type Lesson = {
  time: string
  title: string
  things: string[]
  replacement?: boolean
}

export type Homework = {
  id: string
  subject: string
  task: string
  dueLabel: string
  status: HomeworkStatus
}

export type Book = {
  id: string
  title: string
  author: string
  status: 'Нужно прочитать' | 'Читаю' | 'Прочитано'
  rating?: number
}

export type Club = {
  id: string
  title: string
  time: string
  location: string
  things: string[]
  reminder: string
  cancelled?: boolean
}
