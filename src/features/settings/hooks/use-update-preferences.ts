import { useMutation, useQueryClient } from '@tanstack/react-query'
import { appQueryKeys, updatePreferences } from '@/lib/app-api'

// Saves user preferences (default model, titles, system models) and refreshes
// every query that reads them.
export function useUpdatePreferences() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updatePreferences,
    onSuccess: async function refresh() {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: appQueryKeys.providers }),
        queryClient.invalidateQueries({ queryKey: appQueryKeys.models }),
        queryClient.invalidateQueries({ queryKey: appQueryKeys.preferences }),
      ])
    },
  })
}
