import { contextBridge, ipcRenderer } from 'electron'

const windowKind = process.argv.includes('--kairos-window=popup')
  ? 'popup'
  : 'main'

function markDesktop(): void {
  document.documentElement.dataset.desktop = windowKind
}

if (document.documentElement) markDesktop()
else document.addEventListener('DOMContentLoaded', markDesktop, { once: true })

contextBridge.exposeInMainWorld('kairosDesktop', {
  platform: 'linux',
  isDesktop: true,
  hidePopup: function hidePopup() {
    return ipcRenderer.invoke('kairos:hide-popup')
  },
  openMain: function openMain() {
    return ipcRenderer.invoke('kairos:open-main')
  },
  closeWindow: function closeWindow() {
    return ipcRenderer.invoke('kairos:close-window')
  },
  toggleMaximize: function toggleMaximize() {
    return ipcRenderer.invoke('kairos:toggle-maximize')
  },
})
