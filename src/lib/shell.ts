export type ServerError =
  | 'invalid-url'
  | 'insecure-not-allowed'
  | 'unreachable'
  | 'certificate'
  | 'not-kairos'
export type ServerResult =
  | { ok: true; origin: string; insecure: boolean; overriddenByEnv?: boolean }
  | { ok: false; error: ServerError }
export type HotkeyAction = 'show' | 'new-chat'
export type DesktopSettings = {
  hotkey: string
  hotkeyAction: HotkeyAction
}
export type KairosDesktop = {
  platform: 'linux'
  isDesktop: true
  server: string | null
  setServer: (url: string) => Promise<ServerResult>
  // Missing in desktop builds older than the Desktop settings tab.
  settings?: {
    get: () => Promise<DesktopSettings>
    setHotkeyAction: (action: HotkeyAction) => Promise<DesktopSettings>
  }
  onNewChat?: (listener: () => void) => () => void
}
declare global {
  var kairosDesktop: KairosDesktop | undefined
}
export type Shell = {
  isDesktop: boolean
  providesIdentity: boolean
  providesWindowControls: boolean
  server: string | null
  canChangeServer: boolean
  canConfigureDesktop: boolean
}

export function getDesktopBridge(): KairosDesktop | undefined {
  return typeof window === 'undefined' ? undefined : window.kairosDesktop
}
export function getShell(): Shell {
  const bridge = getDesktopBridge()
  const isDesktop = bridge?.isDesktop === true
  return {
    isDesktop,
    providesIdentity: isDesktop,
    providesWindowControls: isDesktop,
    server: isDesktop ? bridge.server : null,
    canChangeServer: isDesktop && typeof bridge.setServer === 'function',
    canConfigureDesktop: isDesktop && bridge.settings !== undefined,
  }
}
