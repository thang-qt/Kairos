import { useState, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useDeleteSession } from './use-delete-session'
import { useRenameSession } from './use-rename-session'
import { useSessionShortcuts } from './use-session-shortcuts'
import { appQueryKeys, isUnauthorizedError, logout } from '@/lib/app-api'
import type { SessionMeta } from '../types'
import { getSessionDisplayTitle } from '../utils'

type SearchSession = Pick<SessionMeta, 'friendlyId'> & {
  messageId?: string
}

export function searchForSessionNavigation(session: SearchSession) {
  const messageId = session.messageId?.trim()
  return messageId ? { messageId } : {}
}

type UseSidebarActionsProps = {
  sessions: Array<SessionMeta>
  activeFriendlyId: string
  onCreateSession: () => void
  onSelectSession?: () => void
  onActiveSessionDelete?: () => void
}

export function useSidebarActions({
  sessions,
  activeFriendlyId,
  onCreateSession,
  onSelectSession,
  onActiveSessionDelete,
}: UseSidebarActionsProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { deleteSession } = useDeleteSession()
  const { renameSession } = useRenameSession()

  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameSessionKey, setRenameSessionKey] = useState<string | null>(null)
  const [renameFriendlyId, setRenameFriendlyId] = useState<string | null>(null)
  const [renameSessionTitle, setRenameSessionTitle] = useState('')

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteSessionKey, setDeleteSessionKey] = useState<string | null>(null)
  const [deleteFriendlyId, setDeleteFriendlyId] = useState<string | null>(null)
  const [deleteSessionTitle, setDeleteSessionTitle] = useState('')

  const [searchDialogOpen, setSearchDialogOpen] = useState(false)

  async function handleLoggedOut() {
    queryClient.removeQueries({ queryKey: ['chat'] })
    queryClient.removeQueries({ queryKey: appQueryKeys.me })
    queryClient.removeQueries({ queryKey: appQueryKeys.providers })
    queryClient.removeQueries({ queryKey: appQueryKeys.models })
    queryClient.removeQueries({ queryKey: appQueryKeys.preferences })
    await navigate({ to: '/auth', replace: true })
  }

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: handleLoggedOut,
    onError: async function handleLogoutError(error) {
      if (!isUnauthorizedError(error)) return
      await handleLoggedOut()
    },
  })

  const navigateSession = useCallback(
    function navigateSession(direction: 'up' | 'down') {
      if (sessions.length <= 1) return
      const currentIndex = sessions.findIndex(function findActiveSession(s) {
        return s.friendlyId === activeFriendlyId
      })
      let targetIndex = currentIndex
      if (direction === 'up') {
        targetIndex = currentIndex - 1
        if (targetIndex < 0) {
          targetIndex = sessions.length - 1
        }
      } else {
        targetIndex = currentIndex + 1
        if (targetIndex >= sessions.length) {
          targetIndex = 0
        }
      }
      const targetSession = sessions[targetIndex]
      if (targetSession) {
        void navigate({
          to: '/chat/$sessionKey',
          params: { sessionKey: targetSession.friendlyId },
          search: {},
        })
        onSelectSession?.()
      }
    },
    [sessions, activeFriendlyId, navigate, onSelectSession],
  )

  useSessionShortcuts({
    onNewSession: onCreateSession,
    onSearchSessions: function openSearch() {
      setSearchDialogOpen(true)
    },
    onNavigateSession: navigateSession,
  })

  function handleSearchDialogOpenChange(nextOpen: boolean) {
    setSearchDialogOpen(nextOpen)
  }

  const handleSearchSelect = useCallback(
    function handleSearchSelect(session: SearchSession) {
      setSearchDialogOpen(false)
      void navigate({
        to: '/chat/$sessionKey',
        params: { sessionKey: session.friendlyId },
        search: searchForSessionNavigation(session),
      })
      onSelectSession?.()
    },
    [navigate, onSelectSession],
  )

  const handleOpenRename = useCallback(function handleOpenRename(
    session: SessionMeta,
  ) {
    setRenameSessionKey(session.key)
    setRenameFriendlyId(session.friendlyId)
    setRenameSessionTitle(
      session.label || session.title || session.derivedTitle || '',
    )
    setRenameDialogOpen(true)
  }, [])

  const handleSaveRename = useCallback(
    function handleSaveRename(newTitle: string) {
      if (renameSessionKey && renameFriendlyId) {
        void renameSession({
          sessionKey: renameSessionKey,
          friendlyId: renameFriendlyId,
          newTitle,
        })
      }
      setRenameDialogOpen(false)
      setRenameSessionKey(null)
      setRenameFriendlyId(null)
    },
    [renameSession, renameSessionKey, renameFriendlyId],
  )

  const handleOpenDelete = useCallback(function handleOpenDelete(
    session: SessionMeta,
  ) {
    setDeleteSessionKey(session.key)
    setDeleteFriendlyId(session.friendlyId)
    setDeleteSessionTitle(getSessionDisplayTitle(session))
    setDeleteDialogOpen(true)
  }, [])

  const handleConfirmDelete = useCallback(
    function handleConfirmDelete() {
      if (deleteSessionKey && deleteFriendlyId) {
        const isActive = deleteFriendlyId === activeFriendlyId
        if (isActive && onActiveSessionDelete) {
          onActiveSessionDelete()
        }
        void deleteSession(deleteSessionKey, deleteFriendlyId, isActive)
      }
      setDeleteDialogOpen(false)
      setDeleteSessionKey(null)
      setDeleteFriendlyId(null)
    },
    [
      activeFriendlyId,
      deleteFriendlyId,
      deleteSession,
      deleteSessionKey,
      onActiveSessionDelete,
    ],
  )

  const handleLogout = useCallback(
    function handleLogout() {
      logoutMutation.mutate()
    },
    [logoutMutation],
  )

  return {
    renameDialogOpen,
    setRenameDialogOpen,
    renameSessionTitle,
    handleOpenRename,
    handleSaveRename,

    deleteDialogOpen,
    setDeleteDialogOpen,
    deleteSessionTitle,
    handleOpenDelete,
    handleConfirmDelete,

    searchDialogOpen,
    setSearchDialogOpen,
    handleSearchDialogOpenChange,
    handleSearchSelect,

    isLoggingOut: logoutMutation.isPending,
    handleLogout,
  }
}
