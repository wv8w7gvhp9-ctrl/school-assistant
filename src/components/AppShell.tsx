import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react'
import { pullRefreshDistance, pullRefreshThreshold, shouldRefreshAfterPull, type PullPoint } from '../domain/pullToRefresh'
import { pwaUpdateStore } from '../domain/pwaUpdate'
import type { ChildTab } from '../domain/types'
import { useChildSession } from './ChildSession'
import { Icon } from './Icon'
import { NetworkStatus } from './NetworkStatus'
import { OfflineSyncManager } from './OfflineSyncManager'
import { PushNotificationSettings } from './PushNotificationSettings'
import { ChildStarHistory } from './StarHistory'

const navigation: { id: ChildTab; label: string }[] = [
  { id: 'today', label: 'Сегодня' },
  { id: 'schedule', label: 'Расписание' },
  { id: 'homework', label: 'Домашка' },
  { id: 'books', label: 'Книги' },
  { id: 'clubs', label: 'Кружки' },
]

export function AppShell({ activeTab, onTabChange, onRefresh, children }: { activeTab: ChildTab; onTabChange: (tab: ChildTab) => void; onRefresh: () => void; children: ReactNode }) {
  const profile = useChildSession()
  const pullStart = useRef<PullPoint | null>(null)
  const pullDistanceRef = useRef(0)
  const [profileOpen, setProfileOpen] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  useEffect(() => {
    if (!profileOpen) return
    document.body.classList.add('sheet-open')
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setProfileOpen(false) }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.classList.remove('sheet-open')
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [profileOpen])

  function canStartPull(target: EventTarget | null) {
    if (!(target instanceof Element)) return true
    return !target.closest('input, textarea, select, [role="dialog"], [data-disable-pull-refresh]')
  }

  function handleTouchStart(event: ReactTouchEvent<HTMLElement>) {
    if (refreshing || window.scrollY > 0 || !canStartPull(event.target)) return
    const touch = event.touches[0]
    pullStart.current = { x: touch.clientX, y: touch.clientY }
  }

  function handleTouchMove(event: ReactTouchEvent<HTMLElement>) {
    if (!pullStart.current || window.scrollY > 0) return
    const touch = event.touches[0]
    const distance = pullRefreshDistance(pullStart.current, { x: touch.clientX, y: touch.clientY })
    pullDistanceRef.current = distance
    setPullDistance(distance)
  }

  async function handleTouchEnd() {
    pullStart.current = null
    if (!shouldRefreshAfterPull(pullDistanceRef.current)) {
      pullDistanceRef.current = 0
      setPullDistance(0)
      return
    }
    setRefreshing(true)
    pullDistanceRef.current = pullRefreshThreshold
    setPullDistance(pullRefreshThreshold)
    await pwaUpdateStore.checkForUpdate()
    onRefresh()
    await new Promise<void>((resolve) => window.setTimeout(resolve, 600))
    setRefreshing(false)
    pullDistanceRef.current = 0
    setPullDistance(0)
  }

  function resetPull() {
    pullStart.current = null
    pullDistanceRef.current = 0
    setPullDistance(0)
  }

  const pullStyle = { '--pull-distance': `${pullDistance}px`, opacity: Math.min(1, pullDistance / 48) } as CSSProperties
  return <div className="app-shell child-shell">
    <header className="top-bar">
      <div className="brand">Школьный помощник</div>
      <button className="profile-button" type="button" aria-label="Профиль ребёнка" aria-expanded={profileOpen} onClick={() => setProfileOpen(true)}><Icon name="profile" /></button>
    </header>
    <NetworkStatus />
    <OfflineSyncManager />
    <main className="content" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={() => void handleTouchEnd()} onTouchCancel={resetPull}>
      {(pullDistance > 0 || refreshing) && <div className={`pull-refresh-indicator ${refreshing ? 'refreshing' : ''} ${shouldRefreshAfterPull(pullDistance) ? 'ready' : ''}`} style={pullStyle} role="status" aria-live="polite"><Icon name="refresh" /><span>{refreshing ? 'Обновляем…' : shouldRefreshAfterPull(pullDistance) ? 'Отпусти, чтобы обновить' : 'Потяни вниз'}</span></div>}
      {children}
    </main>
    <nav className="bottom-nav" aria-label="Основная навигация">
      {navigation.map((item) => <button key={item.id} type="button" className={activeTab === item.id ? 'nav-item active' : 'nav-item'} onClick={() => onTabChange(item.id)} aria-current={activeTab === item.id ? 'page' : undefined}>
        <Icon name={item.id} /><span>{item.label}</span>
      </button>)}
    </nav>
    {profileOpen && <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileOpen(false) }}><section className="sheet-panel profile-sheet" role="dialog" aria-modal="true" aria-labelledby="child-profile-title"><div className="sheet-heading"><div><p className="eyebrow">Профиль ребёнка</p><h2 id="child-profile-title">{profile?.childName ?? 'Школьный помощник'}</h2></div><button type="button" className="sheet-close" aria-label="Закрыть профиль" onClick={() => setProfileOpen(false)}>×</button></div>{profile && <ChildStarHistory childId={profile.childId} />}<section className="child-notifications"><h3>Уведомления</h3><p>Здесь можно подключить напоминания только для этого устройства. Время меняет родитель.</p><PushNotificationSettings role="child" /></section></section></div>}
  </div>
}
