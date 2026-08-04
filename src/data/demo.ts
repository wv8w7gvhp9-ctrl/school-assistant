import type { Book, Club, Homework, Lesson } from '../domain/types'

export const child = { name: 'Миша', stars: 12 }

export const todayLessons: Lesson[] = [
  { time: '09:00', title: 'Математика', things: ['Тетрадь в клетку', 'Учебник'] },
  { time: '09:50', title: 'Русский язык', things: ['Тетрадь в линейку', 'Пенал'] },
  { time: '10:50', title: 'Чтение', things: ['Книга', 'Дневник чтения'] },
]

export const homework: Homework[] = [
  { id: 'h1', subject: 'Математика', task: 'Решить примеры № 12 и 13', dueLabel: 'На завтра', status: 'todo' },
  { id: 'h2', subject: 'Русский язык', task: 'Выучить словарные слова', dueLabel: 'На завтра', status: 'needs_revision' },
  { id: 'h3', subject: 'Чтение', task: 'Прочитать главы 3–4', dueLabel: 'Сегодня', status: 'pending_review' },
  { id: 'h4', subject: 'Окружающий мир', task: 'Подготовить рассказ о птице', dueLabel: 'Выполнено', status: 'approved' },
]

export const books: Book[] = [
  { id: 'b1', title: 'Денискины рассказы', author: 'Виктор Драгунский', status: 'Читаю' },
  { id: 'b2', title: 'Рассказы о животных', author: 'Виталий Бианки', status: 'Нужно прочитать' },
  { id: 'b3', title: 'Приключения Незнайки', author: 'Николай Носов', status: 'Прочитано', rating: 5 },
]

export const clubs: Club[] = [
  { id: 'c1', title: 'Робототехника', time: '17:00–18:00', location: 'Кабинет 14', things: ['Конструктор', 'Тетрадь'], reminder: 'Напомним в 16:30' },
  { id: 'c2', title: 'Рисование', time: '16:30–17:30', location: 'Творческая студия', things: ['Фартук', 'Папка для рисунков'], reminder: 'Напомним в 16:00' },
]
