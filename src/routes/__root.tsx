import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'

import { appQueryClient } from '@/lib/query-client'

type RouterContext = {
  queryClient: typeof appQueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: RootNotFound,
})

function RootLayout() {
  return (
    <QueryClientProvider client={appQueryClient}>
      <div className="root">
        <Outlet />
      </div>
    </QueryClientProvider>
  )
}

function RootNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <p className="text-pretty text-sm text-primary-700">Page not found.</p>
    </div>
  )
}
