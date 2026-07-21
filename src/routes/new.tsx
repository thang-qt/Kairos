import { createFileRoute, redirect } from '@tanstack/react-router'
import { beginFreshNewChat } from '@/features/chat/conversation-settings'

export const Route = createFileRoute('/new')({
  beforeLoad: function redirectToNewChat() {
    if (typeof window !== 'undefined') beginFreshNewChat()
    throw redirect({
      to: '/chat/$sessionKey',
      params: { sessionKey: 'new' },
      search: {},
      replace: true,
    })
  },
  component: function NewChatRoute() {
    return null
  },
})
