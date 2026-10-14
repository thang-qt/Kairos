// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import {
  createMemoryHistory,
  createRouter,
  isRedirect,
} from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { Route } from './connect'
import { routeTree } from '@/routeTree.gen'

afterEach(function reset() {
  Reflect.deleteProperty(window, 'kairosDesktop')
  vi.unstubAllGlobals()
})
it('keeps the legacy web redirect to new chat', function web() {
  const guard = Route.options.beforeLoad as () => void
  try {
    guard()
    throw new Error('Expected redirect')
  } catch (error) {
    expect(isRedirect(error)).toBe(true)
    expect((error as { options: { to: string } }).options.to).toBe('/new')
  }
})
it('allows desktop Connect and redirects setup before any auth API calls', async function setup() {
  window.kairosDesktop = {
    platform: 'linux',
    isDesktop: true,
    server: null,
    setServer: vi.fn(),
  }
  expect((Route.options.beforeLoad as () => void)()).toBeUndefined()
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/auth'] }),
    context: { queryClient: new QueryClient() },
  })
  await router.load()
  expect(router.state.location.pathname).toBe('/connect')
  expect(fetch).not.toHaveBeenCalled()
})
