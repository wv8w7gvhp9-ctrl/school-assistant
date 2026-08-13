import { useSyncExternalStore } from 'react'
import { pwaUpdateStore } from '../domain/pwaUpdate'

export function PwaUpdateBanner() {
  const updateReady = useSyncExternalStore(
    pwaUpdateStore.subscribe,
    pwaUpdateStore.getSnapshot,
    () => false,
  )

  if (!updateReady) return null

  return (
    <aside className="pwa-update-banner" role="status" aria-live="polite">
      <div>
        <strong>Доступна новая версия</strong>
        <p>Обновите приложение, когда закончите текущее действие.</p>
      </div>
      <button className="secondary-button" type="button" onClick={() => window.location.reload()}>
        Обновить сейчас
      </button>
    </aside>
  )
}
