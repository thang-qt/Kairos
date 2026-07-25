import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'

import { appQueryClient } from '@/lib/query-client'
import { AppQueryProvider } from '@/lib/app-query-provider'

type RouterContext = {
  queryClient: typeof appQueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: RootNotFound,
})

function RootLayout() {
  return (
    <AppQueryProvider>
      <div className="root">
        <Outlet />
      </div>
    </AppQueryProvider>
  )
}

function RootNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <p className="text-pretty text-sm text-primary-700">Page not found.</p>
    </div>
  )
}
