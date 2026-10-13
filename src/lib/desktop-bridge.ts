export type KairosDesktop = {
  platform: 'linux'
  isDesktop: true
  hidePopup: () => Promise<void>
  openMain: () => Promise<void>
  closeWindow: () => Promise<void>
  toggleMaximize: () => Promise<void>
}

declare global {
  // `window` includes typeof globalThis, so this also types window.kairosDesktop.
  var kairosDesktop: KairosDesktop | undefined
}

export function getDesktopBridge(): KairosDesktop | undefined {
  return typeof window === 'undefined' ? undefined : window.kairosDesktop
}

export function isDesktopShell(): boolean {
  return getDesktopBridge() !== undefined
}
