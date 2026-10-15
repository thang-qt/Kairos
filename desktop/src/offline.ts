const retry = new URLSearchParams(window.location.search).get('retry')
const message = new URLSearchParams(window.location.search).get('message')
if (message) {
  document.querySelector('h1')!.textContent = 'Connect to Kairos'
  document.querySelector('p')!.textContent = message
  document.getElementById('retry')!.hidden = true
}
document
  .getElementById('retry')
  ?.addEventListener('click', function retryConnection() {
    if (!retry) return
    const url = new URL(retry)
    if (url.protocol === 'http:' || url.protocol === 'https:')
      window.location.assign(url.href)
  })
