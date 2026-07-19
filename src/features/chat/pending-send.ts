let pendingGeneration = false
let recentSession: { friendlyId: string; at: number } | null = null

export function setPendingGeneration(value: boolean) {
  pendingGeneration = value
}

export function hasPendingGeneration() {
  return pendingGeneration
}

export function resetPendingGeneration() {
  pendingGeneration = false
}

export function setRecentSession(friendlyId: string) {
  recentSession = { friendlyId, at: Date.now() }
}

export function isRecentSession(friendlyId: string, maxAgeMs = 15000) {
  if (!recentSession) return false
  if (recentSession.friendlyId !== friendlyId) return false
  if (Date.now() - recentSession.at > maxAgeMs) return false
  return true
}
