/// <reference lib="webworker" />

type PrecacheEntry = string | { url: string; revision?: string | null }
type PushPayload = { title?: string; body?: string; url?: string; tag?: string }

const sw = self as unknown as ServiceWorkerGlobalScope & { __WB_MANIFEST: PrecacheEntry[] }
const CACHE_NAME = 'school-assistant-precache-v1'
const precacheEntries = (self as unknown as ServiceWorkerGlobalScope & { __WB_MANIFEST: PrecacheEntry[] }).__WB_MANIFEST
const precacheUrls = precacheEntries.map((entry) => new URL(typeof entry === 'string' ? entry : entry.url, sw.location.origin).pathname)

sw.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(precacheUrls)))
  void sw.skipWaiting()
})

sw.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    const requests = await cache.keys()
    await Promise.all(requests.map((request) => {
      const path = new URL(request.url).pathname
      return precacheUrls.includes(path) || precacheUrls.includes(request.url) ? Promise.resolve(false) : cache.delete(request)
    }))
    await Promise.all((await caches.keys()).filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
    await sw.clients.claim()
  })())
})

sw.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin !== sw.location.origin) return

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => {
      const cached = await caches.match('/index.html')
      return cached ?? Response.error()
    }))
    return
  }

  if (precacheUrls.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request)))
  }
})

sw.addEventListener('push', (event) => {
  let payload: PushPayload = {}
  try {
    payload = event.data?.json() as PushPayload ?? {}
  } catch {
    payload = { body: event.data?.text() }
  }
  const title = payload.title?.trim() || 'Школьный помощник'
  const body = payload.body?.trim() || 'Открой приложение, чтобы посмотреть обновление.'
  const url = payload.url?.startsWith('/') ? payload.url : '/'
  event.waitUntil(sw.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag?.slice(0, 120),
    data: { url },
  }))
})

sw.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const requestedUrl = typeof event.notification.data?.url === 'string' && event.notification.data.url.startsWith('/')
    ? event.notification.data.url
    : '/'
  const targetUrl = new URL(requestedUrl, sw.location.origin).href
  event.waitUntil((async () => {
    const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find((client) => new URL(client.url).origin === sw.location.origin)
    if (existing) {
      await existing.navigate(targetUrl)
      return existing.focus()
    }
    return sw.clients.openWindow(targetUrl)
  })())
})
