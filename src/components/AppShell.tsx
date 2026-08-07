import { useEffect, useState, type ReactNode } from 'react'
import type { ChildTab } from '../domain/types'
import { useChildSession } from './ChildSession'
import { Icon } from './Icon'
import { NetworkStatus } from './NetworkStatus'
import { OfflineSyncManager } from './OfflineSyncManager'
import { PushNotificationSettings } from './PushNotificationSettings'

const navigation: { id: ChildTab; label: string }[] = [
  { id: 'today', label: 'Сегодня' },
  { id: 'schedule', label: 'Расписание' },
  { id: 'homework', label: 'Домашка' },
  { id: 'books', label: 'Книги' },
  { id: 'clubs', label: 'Кружки' },
]

export function AppShell({ activeTab, onTabChange, children }: { activeTab: ChildTab; onTabChange: (tab: ChildTab) => void; children: ReactNode }) {
  const profile = useChildSession()
  const [profileOpen, setProfileOpen] = useState(false)
  useEffect(() => {
    if (!profileOpen) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setProfileOpen(false) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [profileOpen])
  return <div className="app-shell child-shell">
    <header className="top-bar">
      <div className="brand">Школьный помощник</div>
      <button className="profile-button" type="button" aria-label="Профиль ребёнка" aria-expanded={profileOpen} onClick={() => setProfileOpen(true)}><Icon name="profile" /></button>
    </header>
    <NetworkStatus />
    <OfflineSyncManager />
    <main className="content">{children}</main>
    <nav className="bottom-nav" aria-label="Основная навигация">
      {navigation.map((item) => <button key={item.id} type="button" className={activeTab === item.id ? 'nav-item active' : 'nav-item'} onClick={() => onTabChange(item.id)} aria-current={activeTab === item.id ? 'page' : undefined}>
        <Icon name={item.id} /><span>{item.label}</span>
      </button>)}
    </nav>
    {profileOpen && <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileOpen(false) }}><section className="profile-sheet" role="dialog" aria-modal="true" aria-labelledby="child-profile-title"><div className="sheet-heading"><div><p className="eyebrow">Профиль ребёнка</p><h2 id="child-profile-title">{profile?.childName ?? 'Школьный помощник'}</h2></div><button type="button" className="sheet-close" aria-label="Закрыть профиль" onClick={() => setProfileOpen(false)}>×</button></div><section className="child-notifications"><h3>Уведомления</h3><p>Здесь можно подключить напоминания только для этого устройства. Время меняет родитель.</p><PushNotificationSettings role="child" /></section></section></div>}
  </div>
}
