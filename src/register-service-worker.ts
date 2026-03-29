export function registerServiceWorker() {
  if (import.meta.env.DEV) {
    return
  }

  if (!('serviceWorker' in navigator)) {
    return
  }

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
  })
}
