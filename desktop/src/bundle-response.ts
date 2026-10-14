import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  isNavigation,
  isServiceWorkerPath,
  resolveBundlePath,
} from './bundle-path.js'
import { setupOrigin } from './server-state.js'

export type BundleFetch = (
  input: Request | string,
  options: { bypassCustomProtocolHandlers: true },
) => Promise<Response>

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
}

export function createBundleHandler(
  origin: string | (() => string),
  directory: string,
  fetch: BundleFetch,
): (request: Request) => Promise<Response> {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const currentOrigin = typeof origin === 'function' ? origin() : origin
    if (
      url.origin === setupOrigin &&
      (currentOrigin !== setupOrigin ||
        url.pathname === '/api' ||
        url.pathname.startsWith('/api/'))
    ) {
      return Response.json({ error: 'no server configured' }, { status: 503 })
    }
    if (
      url.origin !== currentOrigin ||
      url.pathname === '/api' ||
      url.pathname.startsWith('/api/')
    ) {
      // Forward the original Request and return its Response without buffering or
      // reconstructing either body. Chromium uses the same default cookie session.
      return fetch(request, { bypassCustomProtocolHandlers: true })
    }
    let pathname: string
    try {
      pathname = decodeURIComponent(url.pathname)
    } catch {
      return new Response(null, { status: 400 })
    }
    if (isServiceWorkerPath(pathname))
      return new Response(null, { status: 404 })
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return new Response(null, { status: 405 })
    const file = await resolveBundlePath(
      directory,
      url.pathname,
      isNavigation(request),
    )
    if (!file) return new Response(null, { status: 404 })
    const response = await fetch(pathToFileURL(file).href, {
      bypassCustomProtocolHandlers: true,
    })
    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status,
      headers: {
        'Content-Type':
          contentTypes[extname(file).toLowerCase()] ||
          'application/octet-stream',
        'Cache-Control': 'no-store',
      },
    })
  }
}
