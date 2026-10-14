export type KairosDesktop = {
  platform: 'linux'
  isDesktop: true
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
