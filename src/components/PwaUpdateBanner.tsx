import { useState, useSyncExternalStore } from 'react'
import { pwaUpdateStore } from '../domain/pwaUpdate'

export function PwaUpdateBanner() {
  const [updating, setUpdating] = useState(false)
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
      <button className="secondary-button" type="button" disabled={updating} onClick={() => {
        setUpdating(true)
        void pwaUpdateStore.applyUpdate().catch((error) => {
          console.error('Не удалось применить обновление PWA', error)
          setUpdating(false)
        })
      }}>
        {updating ? 'Обновляем…' : 'Обновить сейчас'}
      </button>
    </aside>
  )
}
