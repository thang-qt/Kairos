import { contextBridge, ipcRenderer } from 'electron'

function markDesktop(): void {
  document.documentElement.dataset.desktop = 'main'
}

if (document.documentElement) markDesktop()
else document.addEventListener('DOMContentLoaded', markDesktop, { once: true })

contextBridge.exposeInMainWorld('kairosDesktop', {
  platform: 'linux',
  isDesktop: true,
  server:
    process.argv
      .find(function serverArgument(value) {
        return value.startsWith('--kairos-server=')
      })
      ?.slice('--kairos-server='.length) || null,
  setServer: function setServer(url: string) {
    return ipcRenderer.invoke('kairos:set-server', url)
  },
  getAppInfo: function getAppInfo() {
    return ipcRenderer.invoke('kairos:app-info')
  },
  settings: {
    get: function getSettings() {
      return ipcRenderer.invoke('kairos:desktop-settings')
    },
    setHotkeyAction: function setHotkeyAction(action: string) {
      return ipcRenderer.invoke('kairos:set-hotkey-action', action)
    },
  },
  // Returns an unsubscribe function. The listener gets no IPC event object.
  onNewChat: function onNewChat(listener: () => void) {
    function handleNewChat() {
      listener()
    }
    ipcRenderer.on('kairos:new-chat', handleNewChat)
    return function unsubscribe() {
      ipcRenderer.removeListener('kairos:new-chat', handleNewChat)
    }
  },
})

// Sandboxed preloads cannot require another local module; keep this allowlist
// in sync with titlebar-state.ts. The main process validates every update.
const themeKeys = [
  '--color-surface',
  '--color-ink',
  '--color-primary-100',
  '--color-primary-200',
  '--color-primary-500',
  '--color-primary-700',
  '--color-primary-950',
]
let themeFrame = 0

function queueTheme(): void {
  if (themeFrame) return
  themeFrame = requestAnimationFrame(function reportTheme() {
    themeFrame = 0
    const styles = getComputedStyle(document.documentElement)
    const theme: Record<string, string> = {}
    for (const key of themeKeys) {
      const value = styles.getPropertyValue(key).trim()
      if (value) theme[key] = value
    }
    const top =
      document
        .querySelector('[data-shell-top]')
        ?.getAttribute('data-shell-top') === 'frame'
        ? 'frame'
        : 'surface'
    ipcRenderer.send('kairos:theme', { theme, top })
  })
}

function observeTheme(): void {
  const observer = new MutationObserver(queueTheme)
  observer.observe(document.documentElement, {
    attributes: true,
    subtree: true,
    childList: true,
    attributeFilter: ['data-shell-top', 'class'],
  })
  matchMedia('(prefers-color-scheme: dark)').addEventListener(
    'change',
    queueTheme,
  )
  queueTheme()
}
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', observeTheme, { once: true })
else observeTheme()
window.addEventListener('load', queueTheme, { once: true })
