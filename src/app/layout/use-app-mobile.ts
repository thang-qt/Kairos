import { useLayoutEffect, useState } from 'react'
import { setAppShellUiState } from './app-shell-ui'
import type { QueryClient } from '@tanstack/react-query'

export function useAppMobile(queryClient: QueryClient) {
  const [isMobile, setIsMobile] = useState(false)

  useLayoutEffect(function initMediaListener() {
    const media = window.matchMedia('(max-width: 768px)')
    function update() {
      setIsMobile(media.matches)
    }
    update()
    media.addEventListener('change', update)
    return function cleanup() {
      media.removeEventListener('change', update)
    }
  }, [])

  useLayoutEffect(
    function handleMobileCollapse() {
      if (!isMobile) return
      setAppShellUiState(queryClient, function collapse(state) {
        return { ...state, isSidebarCollapsed: true }
      })
    },
    [isMobile, queryClient],
  )

  return { isMobile }
}
