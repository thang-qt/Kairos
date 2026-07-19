import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChatScreen } from '@/features/chat/chat-screen'
import { moveHistoryMessages } from '@/features/chat/chat-queries'
import { beginFreshNewChat } from '@/features/chat/conversation-settings'
import { requireAuthenticatedUser } from '@/lib/route-auth'

export const Route = createFileRoute('/chat/$sessionKey')({
  beforeLoad: async function ensureAuthenticatedRoute({ context, params }) {
    await requireAuthenticatedUser(context)
    if (params.sessionKey === 'new' && typeof window !== 'undefined') {
      beginFreshNewChat()
    }
  },
  component: ChatRoute,
})

function ChatRoute() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [forcedSession, setForcedSession] = useState<{
    friendlyId: string
    sessionKey: string
  } | null>(null)
  const params = Route.useParams()
  const activeFriendlyId =
    typeof params.sessionKey === 'string' ? params.sessionKey : 'main'
  const isNewChat = activeFriendlyId === 'new'
  const forcedSessionKey =
    forcedSession?.friendlyId === activeFriendlyId
      ? forcedSession.sessionKey
      : undefined
  const handleSessionResolved = useCallback(
    function handleSessionResolved(payload: {
      friendlyId: string
      sessionKey: string
    }) {
      moveHistoryMessages(
        queryClient,
        'new',
        'new',
        payload.friendlyId,
        payload.sessionKey,
      )
      setForcedSession({
        friendlyId: payload.friendlyId,
        sessionKey: payload.sessionKey,
      })
      navigate({
        to: '/chat/$sessionKey',
        params: { sessionKey: payload.friendlyId },
        replace: true,
      })
    },
    [navigate, queryClient],
  )

  return (
    <ChatScreen
      activeFriendlyId={activeFriendlyId}
      isNewChat={isNewChat}
      forcedSessionKey={forcedSessionKey}
      onSessionResolved={isNewChat ? handleSessionResolved : undefined}
    />
  )
}
