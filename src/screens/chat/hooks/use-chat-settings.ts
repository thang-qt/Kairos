import { useCallback, useState } from 'react'

export function useChatSettings() {
  const [settingsOpen, setSettingsOpen] = useState(false)

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true)
  }, [])

  const closeSettings = useCallback(() => {
    setSettingsOpen(false)
  }, [])

  const copySessionsDir = useCallback(() => {
    // No-op for the frontend mock backend.
  }, [])

  const copyStorePath = useCallback(() => {
    // No-op for the frontend mock backend.
  }, [])

  return {
    settingsOpen,
    setSettingsOpen,
    pathsLoading: false,
    pathsError: null,
    paths: null,
    handleOpenSettings,
    closeSettings,
    copySessionsDir,
    copyStorePath,
  }
}
