const retry = new URLSearchParams(window.location.search).get('retry')
document
  .getElementById('retry')
  ?.addEventListener('click', function retryConnection() {
    if (!retry) return
    const url = new URL(retry)
    if (url.protocol === 'http:' || url.protocol === 'https:')
      window.location.assign(url.href)
  })
