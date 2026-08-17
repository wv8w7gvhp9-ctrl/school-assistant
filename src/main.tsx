import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import { pwaUpdateStore } from './domain/pwaUpdate'
import './styles/tokens.css'
import './styles/app.css'

let updateSW: (reloadPage?: boolean) => Promise<void> = async () => {}

updateSW = registerSW({
  immediate: true,
  onNeedReload: () => pwaUpdateStore.notifyReady(() => updateSW(true)),
  onRegisteredSW: (_serviceWorkerUrl, registration) => {
    const check = async () => {
      if (!navigator.onLine) return
      try {
        await registration?.update()
      } catch (error) {
        console.error('Не удалось проверить обновление приложения', error)
      }
    }
    pwaUpdateStore.configureUpdateCheck(check)
    window.addEventListener('focus', () => { void check() })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void check()
    })
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
