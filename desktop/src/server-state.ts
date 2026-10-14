export const setupOrigin = 'https://setup.kairos.invalid'
let server: string | null = null

export function getCurrentServer(): string | null {
  return server
}
export function getCurrentOrigin(): string {
  return server ?? setupOrigin
}
export function setCurrentServer(value: string | null): void {
  server = value
}
