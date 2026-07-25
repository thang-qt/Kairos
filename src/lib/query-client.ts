import { QueryClient } from '@tanstack/react-query'

import {
  createUserScopedQueryPersister,
  persistedQueryCacheMaxAge,
} from './persisted-query-cache'

export const appQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: persistedQueryCacheMaxAge,
    },
  },
})

export const appQueryPersister = createUserScopedQueryPersister(appQueryClient)
