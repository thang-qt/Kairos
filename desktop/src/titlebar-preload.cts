import { contextBridge, ipcRenderer } from 'electron'
import type { TitlebarState } from './titlebar-state.js'

function markMode(): void {
  document.documentElement.dataset.mode =
    new URLSearchParams(location.search).get('mode') || 'light'
}
if (document.documentElement) markMode()
else document.addEventListener('DOMContentLoaded', markMode, { once: true })

contextBridge.exposeInMainWorld('kairosTitlebar', {
  minimize: function minimize() {
    return ipcRenderer.invoke('kairos:titlebar-minimize')
  },
  toggleMaximize: function toggleMaximize() {
    return ipcRenderer.invoke('kairos:titlebar-maximize')
  },
  close: function close() {
    return ipcRenderer.invoke('kairos:titlebar-close')
  },
  onState: function onState(callback: (state: TitlebarState) => void) {
    function receive(_event: Electron.IpcRendererEvent, state: TitlebarState) {
      callback(state)
    }
    ipcRenderer.on('kairos:titlebar-state', receive)
    void ipcRenderer.invoke('kairos:titlebar-state').then(callback)
    return function unsubscribe() {
      ipcRenderer.removeListener('kairos:titlebar-state', receive)
    }
  },
})
