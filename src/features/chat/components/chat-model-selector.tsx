import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  ModelsPayload,
  ProviderModel,
  ProviderPayload,
  UserPreferences,
} from '@/lib/app-api'
import { appQueryKeys, syncModels, updatePreferences } from '@/lib/app-api'
import { ModelPicker } from '@/components/model-picker'
import { mutationErrorMessage } from '@/lib/error-utils'

type ChatModelSelectorProps = {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  models: Array<ProviderModel>
  selectedModelId: string
  defaultModelId?: string
  loading?: boolean
  canSelectModel?: boolean
  defaultModelLocked?: boolean
  onSelectModel: (modelId: string) => void
  className?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
}

function updatePayloadPreferences<T extends { preferences: UserPreferences }>(
  current: T | undefined,
  preferences: UserPreferences,
) {
  if (!current) return current
  return {
    ...current,
    preferences,
  }
}

export function ChatModelSelector({
  open,
  onOpenChange,
  models,
  selectedModelId,
  defaultModelId,
  loading = false,
  canSelectModel = true,
  defaultModelLocked = false,
  onSelectModel,
  className,
  side = 'bottom',
  align = 'start',
}: ChatModelSelectorProps) {
  const queryClient = useQueryClient()
  const [defaultErrorMessage, setDefaultErrorMessage] = useState('')
  const [syncErrorMessage, setSyncErrorMessage] = useState('')
  const normalizedDefaultModelId = defaultModelId?.trim()

  const updatePreferencesMutation = useMutation({
    mutationFn: updatePreferences,
    onSuccess: async function handleSuccess(preferences) {
      setDefaultErrorMessage('')
      setSyncErrorMessage('')
      queryClient.setQueryData(appQueryKeys.preferences, preferences)
      queryClient.setQueryData(
        appQueryKeys.models,
        function updateModels(current: ModelsPayload | undefined) {
          return updatePayloadPreferences(current, preferences)
        },
      )
      queryClient.setQueryData(
        appQueryKeys.providers,
        function updateProviders(current: ProviderPayload | undefined) {
          return updatePayloadPreferences(current, preferences)
        },
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: appQueryKeys.preferences }),
        queryClient.invalidateQueries({ queryKey: appQueryKeys.models }),
        queryClient.invalidateQueries({ queryKey: appQueryKeys.providers }),
      ])
    },
    onError: function handleError(error) {
      setDefaultErrorMessage(
        mutationErrorMessage(error, 'Failed to update default model.'),
      )
    },
  })

  const syncModelsMutation = useMutation({
    mutationFn: syncModels,
    onSuccess: function handleSuccess(payload) {
      setSyncErrorMessage('')
      queryClient.setQueryData(appQueryKeys.models, payload)
      queryClient.setQueryData(appQueryKeys.preferences, payload.preferences)
    },
    onError: function handleError(error) {
      setSyncErrorMessage(
        mutationErrorMessage(error, 'Failed to refresh models.'),
      )
    },
  })

  function handleSelectModel(modelId: string) {
    onSelectModel(modelId)
    setDefaultErrorMessage('')
    setSyncErrorMessage('')
  }

  function handleMakeDefault(modelId: string) {
    setDefaultErrorMessage('')
    void updatePreferencesMutation.mutateAsync({
      defaultModelId: modelId,
    })
  }

  function handleRefreshModels() {
    setSyncErrorMessage('')
    void syncModelsMutation.mutateAsync()
  }

  return (
    <ModelPicker
      open={open}
      onOpenChange={onOpenChange}
      label="Chat model"
      variant="ghost"
      models={models}
      selectedModelId={selectedModelId}
      defaultModelId={normalizedDefaultModelId}
      loading={loading}
      disabled={!canSelectModel}
      side={side}
      align={align}
      className={className}
      error={defaultErrorMessage || syncErrorMessage}
      refreshing={syncModelsMutation.isPending}
      onRefresh={handleRefreshModels}
      onMakeDefault={defaultModelLocked ? undefined : handleMakeDefault}
      onSelectModel={handleSelectModel}
    />
  )
}
