import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, posix, relative, resolve } from 'node:path'

function isInside(root: string, path: string): boolean {
  const remainder = relative(root, path)
  return (
    remainder !== '..' && !remainder.startsWith('../') && !isAbsolute(remainder)
  )
}

export async function resolveBundlePath(
  directory: string,
  pathname: string,
  navigation: boolean,
): Promise<string | undefined> {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }
  if (
    !decoded.startsWith('/') ||
    decoded.includes('\0') ||
    decoded.includes('\\') ||
    decoded.split('/').includes('..')
  )
    return undefined
  const normalized = posix.normalize(decoded)
  const root = await realpath(directory)
  const candidate = resolve(
    root,
    `.${normalized === '/' ? '/index.html' : normalized}`,
  )
  if (!isInside(root, candidate)) return undefined
  try {
    const actual = await realpath(candidate)
    // Reject symlinks pointing outside the bundle rather than applying SPA fallback.
    if (!isInside(root, actual)) return undefined
    if ((await stat(actual)).isFile()) return actual
  } catch (error) {
    if (
      !['ENOENT', 'ENOTDIR'].includes(
        (error as NodeJS.ErrnoException).code || '',
      )
    )
      throw error
  }
  if (!navigation) return undefined
  const index = await realpath(resolve(root, 'index.html'))
  return isInside(root, index) && (await stat(index)).isFile()
    ? index
    : undefined
}

export function isNavigation(request: Request): boolean {
  return (
    request.mode === 'navigate' ||
    (request.headers.get('accept') || '').toLowerCase().includes('text/html')
  )
}

export function isServiceWorkerPath(pathname: string): boolean {
  return (
    pathname === '/sw.js' ||
    pathname === '/registerSW.js' ||
    /^\/workbox-[^/]+\.js$/.test(pathname)
  )
}
