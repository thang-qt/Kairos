import { useCallback, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { chatQueryKeys } from '../chat-queries'
import type { SessionMeta } from '../types'
import { getChatBackend } from '@/lib/chat-backend'

export type PinSessionResult = {
  pinSession: (input: {
    sessionKey: string
    friendlyId: string
    isPinned: boolean
  }) => Promise<void>
  pinning: boolean
  error: string | null
}

export function usePinSession(): PinSessionResult {
  const queryClient = useQueryClient()
  const [pinning, setPinning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async function pinSessionRequest(payload: {
      sessionKey: string
      friendlyId: string
      isPinned: boolean
    }) {
      const backend = getChatBackend()
      await backend.pinConversation(payload)
      return payload
    },
    onMutate: async function onMutate(payload) {
      setError(null)
      await queryClient.cancelQueries({ queryKey: chatQueryKeys.sessions })
      const previousSessions = queryClient.getQueryData(chatQueryKeys.sessions)

      queryClient.setQueryData(
        chatQueryKeys.sessions,
        function update(sessions: unknown) {
          if (!Array.isArray(sessions)) return sessions
          return (sessions as Array<SessionMeta>).map(function mapSession(
            session,
          ) {
            if (
              session.key !== payload.sessionKey &&
              session.friendlyId !== payload.friendlyId
            ) {
              return session
            }
            return {
              ...session,
              isPinned: payload.isPinned,
            }
          })
        },
      )

      return { previousSessions }
    },
    onError: function onError(err, _payload, context) {
      if (context?.previousSessions) {
        queryClient.setQueryData(
          chatQueryKeys.sessions,
          context.previousSessions,
        )
      }
      setError(err instanceof Error ? err.message : String(err))
    },
    onSuccess: function onSuccess() {
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.sessions })
    },
    onSettled: function onSettled() {
      setPinning(false)
    },
  })

  const pinSession = useCallback(
    async function pinSession(input: {
      sessionKey: string
      friendlyId: string
      isPinned: boolean
    }) {
      if (!input.sessionKey || !input.friendlyId) return
      setPinning(true)
      await mutation.mutateAsync(input)
    },
    [mutation],
  )

  return { pinSession, pinning, error }
}
