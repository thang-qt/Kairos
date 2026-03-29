const APP_SHELL_CACHE = 'kairos-app-shell-v1'
const RUNTIME_CACHE = 'kairos-runtime-v1'
const APP_SHELL_URLS = [
  '/',
  '/manifest.json',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/cover.jpg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_URLS)),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => ![APP_SHELL_CACHE, RUNTIME_CACHE].includes(key))
          .map((key) => caches.delete(key)),
      ),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') {
    return
  }

  const requestUrl = new URL(request.url)

  if (requestUrl.origin !== self.location.origin) {
    return
  }

  if (requestUrl.pathname.startsWith('/api')) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request))
    return
  }

  event.respondWith(handleStaticRequest(request))
})

async function handleNavigationRequest(request) {
  try {
    const response = await fetch(request)
    const cache = await caches.open(RUNTIME_CACHE)
    await cache.put(request, response.clone())
    return response
  } catch {
    const cachedResponse =
      (await caches.match(request)) ||
      (await caches.match('/')) ||
      (await caches.match('/index.html'))

    if (cachedResponse) {
      return cachedResponse
    }

    throw new Error('Navigation request failed')
  }
}

async function handleStaticRequest(request) {
  const cachedResponse = await caches.match(request)

  if (cachedResponse) {
    void refreshStaticCache(request)
    return cachedResponse
  }

  const response = await fetch(request)
  const cache = await caches.open(RUNTIME_CACHE)
  await cache.put(request, response.clone())
  return response
}

async function refreshStaticCache(request) {
  try {
    const response = await fetch(request)
    const cache = await caches.open(RUNTIME_CACHE)
    await cache.put(request, response)
  } catch {}
}
