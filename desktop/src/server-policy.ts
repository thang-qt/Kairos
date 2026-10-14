import { setupOrigin } from './server-state.js'

export type ServerError =
  | 'invalid-url'
  | 'insecure-not-allowed'
  | 'unreachable'
  | 'certificate'
  | 'not-kairos'
export type ServerResult =
  | { ok: true; origin: string; insecure: boolean; overriddenByEnv?: boolean }
  | { ok: false; error: ServerError }

function allowsHttp(host: string): boolean {
  host = host.toLowerCase().replace(/\.$/, '')
  if (
    host === 'localhost' ||
    host === '[::1]' ||
    (host.endsWith('.local') && host.length > 6)
  )
    return true
  const parts = host.split('.').map(Number)
  if (
    parts.length !== 4 ||
    parts.some(function invalid(part) {
      return !Number.isInteger(part) || part < 0 || part > 255
    })
  )
    return false
  return (
    parts[0] === 127 ||
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  )
}

export function normalizeServer(input: unknown): ServerResult {
  if (typeof input !== 'string' || !input.trim())
    return { ok: false, error: 'invalid-url' }
  let value = input.trim()
  if (
    !/^[a-z][a-z\d+.-]*:/i.test(value) ||
    /^[^/?#]+:\d+(?:[/?#]|$)/.test(value)
  )
    value = `https://${value}`
  try {
    const url = new URL(value)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.origin === setupOrigin
    )
      return { ok: false, error: 'invalid-url' }
    if (url.protocol === 'http:' && !allowsHttp(url.hostname))
      return { ok: false, error: 'insecure-not-allowed' }
    return { ok: true, origin: url.origin, insecure: url.protocol === 'http:' }
  } catch {
    return { ok: false, error: 'invalid-url' }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export type ProbeFetch = (
  url: string,
  options: RequestInit & { bypassCustomProtocolHandlers: true },
) => Promise<Response>

export async function probeServer(
  input: unknown,
  fetch: ProbeFetch,
): Promise<ServerResult> {
  const normalized = normalizeServer(input)
  if (!normalized.ok) return normalized
  const controller = new AbortController()
  const timer = setTimeout(function timeout() {
    controller.abort()
  }, 8000)
  try {
    let url = `${normalized.origin}/api/app/capabilities`
    for (let count = 0; count < 6; count++) {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        bypassCustomProtocolHandlers: true,
      })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        await response.body?.cancel()
        if (!location) return { ok: false, error: 'not-kairos' }
        const next = new URL(location, url)
        if (next.origin !== normalized.origin || next.username || next.password)
          return { ok: false, error: 'not-kairos' }
        url = next.href
        continue
      }
      if (response.status !== 200) {
        await response.body?.cancel()
        return { ok: false, error: 'not-kairos' }
      }
      let body: unknown
      try {
        body = await response.json()
      } catch (error) {
        if (error instanceof SyntaxError)
          return { ok: false, error: 'not-kairos' }
        throw error
      }
      if (
        !isRecord(body) ||
        !isRecord(body.capabilities) ||
        !isRecord(body.capabilities.auth)
      )
        return { ok: false, error: 'not-kairos' }
      return normalized
    }
    return { ok: false, error: 'not-kairos' }
  } catch (error) {
    const messages: string[] = []
    let cause: unknown = error
    for (let i = 0; i < 5 && cause; i++) {
      messages.push(cause instanceof Error ? cause.message : String(cause))
      cause = isRecord(cause) ? cause.cause : undefined
    }
    return {
      ok: false,
      error: /ERR_CERT_|CERT_/i.test(messages.join(' '))
        ? 'certificate'
        : 'unreachable',
    }
  } finally {
    clearTimeout(timer)
  }
}
