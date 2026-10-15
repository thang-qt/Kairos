import type { TitlebarState } from './titlebar-state.js'

type TitlebarBridge = {
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<void>
  close: () => Promise<void>
  onState: (callback: (state: TitlebarState) => void) => () => void
}
declare global {
  var kairosTitlebar: TitlebarBridge
}

const title = document.getElementById('page-title')!
const maximize = document.getElementById('maximize')!
const restoreIcon = document.getElementById('restore-icon')!
const maximizeIcon = document.getElementById('maximize-icon')!

document
  .getElementById('minimize')!
  .addEventListener('click', function minimizeWindow() {
    void window.kairosTitlebar.minimize()
  })
maximize.addEventListener('click', function maximizeWindow() {
  void window.kairosTitlebar.toggleMaximize()
})
document
  .getElementById('close')!
  .addEventListener('click', function closeWindow() {
    void window.kairosTitlebar.close()
  })

window.kairosTitlebar.onState(function updateState(state) {
  title.textContent = state.title || 'Kairos'
  title.title = state.title || 'Kairos'
  document.documentElement.dataset.focused = String(state.focused)
  document.documentElement.dataset.top = state.top
  restoreIcon.toggleAttribute('hidden', !state.maximized)
  maximizeIcon.toggleAttribute('hidden', state.maximized)
  const label = state.maximized ? 'Restore window' : 'Maximize window'
  maximize.setAttribute('aria-label', label)
  maximize.setAttribute('title', label)
  for (const [key, value] of Object.entries(state.theme)) {
    document.documentElement.style.setProperty(key, value)
  }
})
