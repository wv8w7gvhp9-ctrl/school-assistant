import type { ReactNode } from 'react'
import type { ChildTab } from '../domain/types'
import { Icon } from './Icon'
import { NetworkStatus } from './NetworkStatus'

const navigation: { id: ChildTab; label: string }[] = [
  { id: 'today', label: 'Сегодня' },
  { id: 'schedule', label: 'Расписание' },
  { id: 'homework', label: 'Домашка' },
  { id: 'books', label: 'Книги' },
  { id: 'clubs', label: 'Кружки' },
]

export function AppShell({ activeTab, onTabChange, children }: { activeTab: ChildTab; onTabChange: (tab: ChildTab) => void; children: ReactNode }) {
  return <div className="app-shell child-shell">
    <header className="top-bar">
      <div className="brand">Школьный помощник</div>
      <button className="profile-button" type="button" aria-label="Профиль ребёнка"><Icon name="profile" /></button>
    </header>
    <NetworkStatus />
    <main className="content">{children}</main>
    <nav className="bottom-nav" aria-label="Основная навигация">
      {navigation.map((item) => <button key={item.id} type="button" className={activeTab === item.id ? 'nav-item active' : 'nav-item'} onClick={() => onTabChange(item.id)} aria-current={activeTab === item.id ? 'page' : undefined}>
        <Icon name={item.id} /><span>{item.label}</span>
      </button>)}
    </nav>
  </div>
}
