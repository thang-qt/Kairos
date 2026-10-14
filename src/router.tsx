import { createRouter } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen'
import { appQueryClient } from '@/lib/query-client'
import { ErrorScreen } from '@/components/error-screen'

export const router = createRouter({
  routeTree,
  defaultErrorComponent: ErrorScreen,
  context: {
    queryClient: appQueryClient,
  },
  scrollRestoration: true,
  scrollToTopSelectors: ['[data-scroll-restoration-id="chat-scroll"]'],
  defaultPreloadStaleTime: 0,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
