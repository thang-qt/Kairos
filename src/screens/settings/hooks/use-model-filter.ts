import { useMemo, useState } from 'react'
import { providerModelKey } from '@/lib/model-utils'
import type { ProviderModel, ProviderRecord } from '@/lib/app-api'

type UseModelFilterInput = {
  models: Array<ProviderModel>
  providers: Array<ProviderRecord>
}

export function useModelFilter({ models, providers }: UseModelFilterInput) {
  const [modelSearchQuery, setModelSearchQuery] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('')
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<
    'all' | 'system' | string
  >('all')

  const filteredModels = useMemo(
    function filterModels() {
      let list = models

      // Apply provider filter
      if (selectedProviderFilter === 'system') {
        const systemProviderLabels = new Set(
          providers
            .filter(function isSys(p) {
              return p.systemManaged
            })
            .map(function getLabel(p) {
              return p.label
            }),
        )
        list = list.filter(function matchSys(m) {
          return m.providerLabel && systemProviderLabels.has(m.providerLabel)
        })
      } else if (selectedProviderFilter !== 'all') {
        const targetProvider = providers.find(function matchTarget(p) {
          return (
            p.id === selectedProviderFilter ||
            p.label === selectedProviderFilter
          )
        })
        if (targetProvider) {
          list = list.filter(function matchProv(m) {
            return (
              m.providerLabel === targetProvider.label ||
              m.owned_by === targetProvider.label
            )
          })
        }
      }

      // Apply search query
      const normalizedQuery = modelSearchQuery.trim().toLowerCase()
      if (!normalizedQuery) return list
      return list.filter(function matchesModel(model) {
        const haystack = [
          model.id,
          model.name,
          model.description,
          model.providerLabel,
          model.owned_by,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(normalizedQuery)
      })
    },
    [models, selectedProviderFilter, modelSearchQuery, providers],
  )

  const activeModel = useMemo(
    function getActiveModel() {
      return (
        models.find(function matchModel(m) {
          return (
            providerModelKey(m) === selectedModelId || m.id === selectedModelId
          )
        }) || null
      )
    },
    [models, selectedModelId],
  )

  return {
    modelSearchQuery,
    setModelSearchQuery,
    selectedModelId,
    setSelectedModelId,
    selectedProviderFilter,
    setSelectedProviderFilter,
    filteredModels,
    activeModel,
  }
}
