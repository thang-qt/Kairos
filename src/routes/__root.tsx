import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'

import { appQueryClient } from '@/lib/query-client'
import { AppQueryProvider } from '@/lib/app-query-provider'
import { ErrorScreen } from '@/components/error-screen'

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
    <>
      <ErrorScreen notFound />
    </>
  )
}
