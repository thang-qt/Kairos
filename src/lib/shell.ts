export type ServerError =
  | 'invalid-url'
  | 'insecure-not-allowed'
  | 'unreachable'
  | 'certificate'
  | 'not-kairos'
export type ServerResult =
  | { ok: true; origin: string; insecure: boolean; overriddenByEnv?: boolean }
  | { ok: false; error: ServerError }
export type KairosDesktop = {
  platform: 'linux'
  isDesktop: true
  server: string | null
  setServer: (url: string) => Promise<ServerResult>
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
  }
}
