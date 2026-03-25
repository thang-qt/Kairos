import { createRouter } from '@tanstack/react-router'

// Import the generated route tree
import { routeTree } from './routeTree.gen'
import { appQueryClient } from '@/lib/query-client'

// Create a new router instance
export const getRouter = () => {
  const router = createRouter({
    routeTree,
    context: {
      queryClient: appQueryClient,
    },

    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  })

  return router
}
