type ResolveConversationSessionKeyInput = {
  activeFriendlyId?: string
  activeSessionKey?: string
  forcedSessionKey?: string
  isNewChat?: boolean
  resolvedSessionKey?: string
}

export function resolveConversationSessionKey({
  activeFriendlyId,
  activeSessionKey,
  forcedSessionKey,
  isNewChat = false,
  resolvedSessionKey,
}: ResolveConversationSessionKeyInput): string {
  return (
    forcedSessionKey ||
    resolvedSessionKey ||
    activeSessionKey ||
    (isNewChat ? 'new' : '') ||
    activeFriendlyId ||
    ''
  )
}
