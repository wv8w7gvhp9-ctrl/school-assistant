import { useState, type ReactElement } from 'react'
import { AppShell } from './components/AppShell'
import { AuthGate } from './components/AuthGate'
import { CloudSchedule } from './components/CloudSchedule'
import { CloudHomework } from './components/CloudHomework'
import { CloudBooks } from './components/CloudBooks'
import { CloudClubs } from './components/CloudClubs'
import { useChildSession } from './components/ChildSession'
import { Icon } from './components/Icon'
import { SectionTitle, StarCounter, StatusChip } from './components/UI'
import { books, child, clubs, homework, todayLessons } from './data/demo'
import type { ChildTab } from './domain/types'

const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт']

function Today() {
  const cloudProfile = useChildSession()
  return <section className="screen"><div className="screen-heading"><div><p className="eyebrow">Понедельник, 3 августа</p><h1>Привет, {cloudProfile?.childName ?? child.name}!</h1></div><StarCounter value={child.stars} /></div>
    <article className="hero-card"><div><p className="eyebrow">Ближайшее событие</p><h2>Первый урок в 09:00</h2><p>Математика · Сегодня всё получится</p></div><div className="hero-icon" aria-hidden="true"><Icon name="sun" /></div></article>
    <SectionTitle action="Все">Уроки сегодня</SectionTitle>
    <div className="card lesson-list">{todayLessons.map((lesson) => <div className="lesson-row" key={lesson.time}><time>{lesson.time}</time><span className={`subject-dot ${lesson.title === 'Русский язык' ? 'russian' : lesson.title === 'Чтение' ? 'reading' : 'math'}`} /><div><strong>{lesson.title}</strong><p>{lesson.things.join(' · ')}</p></div></div>)}</div>
    <SectionTitle>После уроков</SectionTitle>
    <article className="card club-summary"><span className="club-icon"><Icon name="clubs" /></span><div><strong>Робототехника</strong><p>Сегодня · 17:00–18:00</p></div><Icon name="chevron" /></article>
    <button className="primary-button" type="button" disabled aria-describedby="demo-note"><Icon name="backpack" />Собрать рюкзак</button>
    <p id="demo-note" className="screen-note">Сбор рюкзака появится после подключения семейного профиля.</p>
  </section>
}

function Schedule() {
  const cloudProfile = useChildSession()
  if (cloudProfile) return <CloudSchedule />
  const [day, setDay] = useState('Вт')
  return <section className="screen"><div className="screen-heading"><div><p className="eyebrow">Неделя 3–7 августа</p><h1>Расписание</h1></div></div>
    <div className="day-picker" aria-label="Выберите день">{weekdays.map((item) => <button type="button" onClick={() => setDay(item)} className={item === day ? 'selected' : ''} key={item}>{item}<span>{item === 'Вт' ? '4' : item === 'Пн' ? '3' : item === 'Ср' ? '5' : item === 'Чт' ? '6' : '7'}</span></button>)}</div>
    <p className="date-label">{day === 'Вт' ? 'Сегодня, 4 августа' : `${day}, эта неделя`}</p>
    <div className="timeline">{todayLessons.map((lesson, index) => <article className="lesson-card" key={lesson.time}><time>{lesson.time}</time><span className="timeline-dot" /><div><p className="eyebrow">Урок {index + 1}</p><h2>{lesson.title}</h2><button type="button" className="details-button">Что взять <Icon name="chevron" /></button></div></article>)}</div>
  </section>
}

function Homework() {
  const cloudProfile = useChildSession()
  return cloudProfile ? <CloudHomework /> : <DemoHomework />
}

function DemoHomework() {
  const [filter, setFilter] = useState('Сегодня')
  const filtered = filter === 'Выполнено'
    ? homework.filter((item) => item.status === 'approved')
    : filter === 'На завтра'
      ? homework.filter((item) => item.dueLabel === 'На завтра')
      : homework.filter((item) => item.dueLabel === 'Сегодня' && item.status !== 'approved')
  return <section className="screen"><div className="screen-heading"><div><p className="eyebrow">На сегодня и завтра</p><h1>Домашка</h1></div></div>
    <div className="filter-pills">{['Сегодня', 'На завтра', 'Выполнено'].map((item) => <button type="button" key={item} className={filter === item ? 'selected' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div>
    <article className="progress-card"><div><span>Выполнено 1 из 4</span><strong>1/4</strong></div><div className="progress-track" aria-label="Выполнено 1 из 4"><span /></div></article>
    <div className="homework-list">{filtered.map((item) => <article className={`card homework-card homework-${item.status}`} key={item.id}><div className="homework-meta"><span>{item.subject}</span><StatusChip status={item.status} /></div><h2>{item.task}</h2><p>{item.dueLabel}</p>{(item.status === 'todo' || item.status === 'needs_revision') && <button className="secondary-button" type="button" disabled>Задание выполнено</button>}</article>)}</div>
    {filter !== 'Выполнено' && <><SectionTitle>Подтверждено</SectionTitle><article className="card compact-homework"><div><strong>{homework[3].subject}</strong><p>{homework[3].task}</p></div><StatusChip status="approved" /></article></>}
  </section>
}

function Books() {
  const cloudProfile = useChildSession()
  return cloudProfile ? <CloudBooks /> : <DemoBooks />
}

function DemoBooks() {
  const [filter, setFilter] = useState('Все')
  return <section className="screen"><div className="screen-heading"><div><p className="eyebrow">Читательский дневник</p><h1>Книги</h1></div></div>
    <div className="filter-pills">{['Все', 'Читаю', 'Прочитано'].map((item) => <button type="button" key={item} className={filter === item ? 'selected' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div>
    <article className="current-book"><div className="book-mark"><Icon name="books" /></div><p className="eyebrow">Сейчас читаю</p><h2>{books[0].title}</h2><p>{books[0].author}</p><button type="button" className="primary-button" disabled>Открыть дневник</button></article>
    <SectionTitle>Мои книги</SectionTitle><div className="book-list">{books.slice(1).map((book) => <article className="card book-card" key={book.id}><div className="book-mark small"><Icon name="books" /></div><div><h2>{book.title}</h2><p>{book.author}</p><span className="book-status">{book.status}{book.rating ? ` · Оценка ${book.rating} из 5` : ''}</span></div>{book.status === 'Нужно прочитать' && <button type="button" className="text-button">Начать</button>}</article>)}</div>
  </section>
}

function Clubs() {
  const cloudProfile = useChildSession()
  return cloudProfile ? <CloudClubs /> : <DemoClubs />
}

function DemoClubs() {
  return <section className="screen"><div className="screen-heading"><div><p className="eyebrow">После уроков</p><h1>Кружки</h1></div></div>
    <article className="next-club"><div className="club-icon large"><Icon name="clubs" /></div><p className="eyebrow">Ближайшее занятие</p><h2>{clubs[0].title}</h2><p>{clubs[0].time} · {clubs[0].location}</p><div className="reminder"><Icon name="clock" />{clubs[0].reminder}</div><h3>Что взять с собой</h3>{clubs[0].things.map((thing) => <label className="check-row" key={thing}><input type="checkbox" /> <span>{thing}</span></label>)}</article>
    <SectionTitle>Регулярные занятия</SectionTitle><div className="club-list">{clubs.map((club) => <article className="card club-row" key={club.id}><span className="club-icon"><Icon name="clubs" /></span><div><h2>{club.title}</h2><p>{club.time} · {club.location}</p></div><Icon name="chevron" /></article>)}</div>
  </section>
}

const screens: Record<ChildTab, () => ReactElement> = { today: Today, schedule: Schedule, homework: Homework, books: Books, clubs: Clubs }

export function App() {
  const [activeTab, setActiveTab] = useState<ChildTab>('today')
  const Screen = screens[activeTab]
  return <AuthGate><AppShell activeTab={activeTab} onTabChange={setActiveTab}><Screen /></AppShell></AuthGate>
}
