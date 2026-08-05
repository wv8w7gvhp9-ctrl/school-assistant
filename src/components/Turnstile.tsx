import { useEffect, useRef } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void }) => string
      remove: (widgetId: string) => void
    }
  }
}

const scriptId = 'cloudflare-turnstile-script'

export function Turnstile({ siteKey, onToken, onError }: { siteKey: string; onToken: (token: string) => void; onError: () => void }) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let widgetId: string | undefined
    let cancelled = false
    const render = () => {
      if (cancelled || !container.current || !window.turnstile) return
      widgetId = window.turnstile.render(container.current, {
        sitekey: siteKey,
        callback: onToken,
        'expired-callback': onError,
        'error-callback': onError,
      })
    }
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null
    if (existing) {
      if (window.turnstile) render()
      else existing.addEventListener('load', render, { once: true })
    } else {
      const script = document.createElement('script')
      script.id = scriptId
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true
      script.addEventListener('load', render, { once: true })
      document.head.appendChild(script)
    }
    return () => {
      cancelled = true
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [siteKey, onToken, onError])

  return <div className="turnstile" ref={container} aria-label="Проверка, что вы не робот" />
}
