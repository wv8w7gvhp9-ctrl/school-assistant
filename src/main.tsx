import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import { pwaUpdateStore } from './domain/pwaUpdate'
import './styles/tokens.css'
import './styles/app.css'

registerSW({
  immediate: true,
  onNeedReload: () => pwaUpdateStore.notifyReady(),
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
