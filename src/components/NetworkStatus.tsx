import { useEffect, useState } from 'react'
import { offlineSavedLabel } from '../lib/offlineCache'

export function useOnlineStatus() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}

export function NetworkStatus() {
  const online = useOnlineStatus()
  if (online) return null
  return <aside className="offline-banner" role="status"><strong>Нет интернета</strong><span>Показываем последние сохранённые данные.</span></aside>
}

export function OfflineDataNote({ savedAt }: { savedAt: string | null }) {
  return <p className="offline-data-note" role="status">Сохранённые данные · {offlineSavedLabel(savedAt)}</p>
}
