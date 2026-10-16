import { useEffect } from 'react'
import {
  Outlet,
  createRootRouteWithContext,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { getDesktopBridge, getShell } from '@/lib/shell'

import { appQueryClient } from '@/lib/query-client'
import { AppQueryProvider } from '@/lib/app-query-provider'
import { ErrorScreen } from '@/components/error-screen'
import { ChatSessionSync } from '@/features/chat/hooks/use-chat-session-sync'

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
  const router = useRouter()
  // The desktop global shortcut can be set to open a new chat.
  useEffect(
    function listenForDesktopNewChat() {
      return getDesktopBridge()?.onNewChat?.(function openNewChat() {
        void router.navigate({ to: '/new' })
      })
    },
    [router],
  )

  return (
    <AppQueryProvider>
      <ChatSessionSync />
      <div className="root">
        <Outlet />
      </div>
    </AppQueryProvider>
  )
}

function RootNotFound() {
  return <ErrorScreen notFound />
}
