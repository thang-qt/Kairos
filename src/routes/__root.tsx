import {
  Outlet,
  createRootRouteWithContext,
  redirect,
} from '@tanstack/react-router'
import { getShell } from '@/lib/shell'

import { appQueryClient } from '@/lib/query-client'
import { AppQueryProvider } from '@/lib/app-query-provider'
import { ErrorScreen } from '@/components/error-screen'

type RouterContext = {
  queryClient: typeof appQueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: function requireConfiguredServer({ location }) {
    const shell = getShell()
    if (
      shell.isDesktop &&
      shell.server === null &&
      location.pathname !== '/connect'
    )
      throw redirect({ to: '/connect', replace: true })
  },
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
