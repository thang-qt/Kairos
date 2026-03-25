import { createRouter } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen'
import { appQueryClient } from '@/lib/query-client'

export const router = createRouter({
  routeTree,
  context: {
    queryClient: appQueryClient,
  },
  scrollRestoration: true,
  defaultPreloadStaleTime: 0,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
