import { useEffect } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { appQueryClient, appQueryPersister } from './query-client'
import { subscribeToPersistedQueryCache } from './persisted-query-cache'

function AppQueryProvider({ children }: { children: ReactNode }) {
  useEffect(function subscribeToPersistence() {
    return subscribeToPersistedQueryCache(appQueryClient, appQueryPersister)
  }, [])

  return (
    <QueryClientProvider client={appQueryClient}>
      {children}
    </QueryClientProvider>
  )
}

export { AppQueryProvider }
