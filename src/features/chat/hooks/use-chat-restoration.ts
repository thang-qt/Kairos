import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatComposerDraft } from '../components/chat-composer'

const CLONE_SCROLL_RESTORE_KEY = 'kairos.clone-scroll-restore'
const CLONE_COMPOSER_DRAFT_KEY = 'kairos.clone-composer-draft'

type UseChatRestorationInput = {
  activeFriendlyId: string
  isNewChat: boolean
}

export function useChatRestoration({
  activeFriendlyId,
  isNewChat,
}: UseChatRestorationInput) {
  const [restoreScrollTop, setRestoreScrollTop] = useState<number | null>(null)
  const [composerDraft, setComposerDraft] = useState<ChatComposerDraft | null>(
    null,
  )
  const scrollTopRef = useRef(0)

  const handleScrollTopChange = useCallback(function handleScrollTopChange(
    scrollTop: number,
  ) {
    scrollTopRef.current = scrollTop
  }, [])

  const handleRestoreScrollTopApplied = useCallback(
    function handleRestoreScrollTopApplied() {
      setRestoreScrollTop(null)
    },
    [],
  )

  const storeCloneScrollRestore = useCallback(
    function storeCloneScrollRestore() {
      if (typeof window === 'undefined') return
      window.sessionStorage.setItem(
        CLONE_SCROLL_RESTORE_KEY,
        JSON.stringify({ scrollTop: scrollTopRef.current }),
      )
    },
    [],
  )

  function stashCloneComposerDraft(targetFriendlyId: string, value: string) {
    if (typeof window === 'undefined') return
    window.sessionStorage.setItem(
      CLONE_COMPOSER_DRAFT_KEY,
      JSON.stringify({ targetFriendlyId, value }),
    )
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = window.sessionStorage.getItem(CLONE_SCROLL_RESTORE_KEY)
    if (!raw) return
    window.sessionStorage.removeItem(CLONE_SCROLL_RESTORE_KEY)
    try {
      const parsed = JSON.parse(raw) as { scrollTop?: unknown }
      if (
        typeof parsed.scrollTop === 'number' &&
        Number.isFinite(parsed.scrollTop)
      ) {
        setRestoreScrollTop(parsed.scrollTop)
      }
    } catch {
      setRestoreScrollTop(null)
    }
  }, [activeFriendlyId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = window.sessionStorage.getItem(CLONE_COMPOSER_DRAFT_KEY)
    if (!raw) return

    try {
      const parsed = JSON.parse(raw) as {
        targetFriendlyId?: unknown
        value?: unknown
      }
      const targetFriendlyId =
        typeof parsed.targetFriendlyId === 'string'
          ? parsed.targetFriendlyId
          : ''
      const value = typeof parsed.value === 'string' ? parsed.value : ''
      const currentFriendlyId = isNewChat ? 'new' : activeFriendlyId
      if (targetFriendlyId !== currentFriendlyId) return

      window.sessionStorage.removeItem(CLONE_COMPOSER_DRAFT_KEY)
      setComposerDraft({
        key: `${targetFriendlyId}:${Date.now()}`,
        value,
      })
    } catch {
      window.sessionStorage.removeItem(CLONE_COMPOSER_DRAFT_KEY)
    }
  }, [activeFriendlyId, isNewChat])

  return {
    restoreScrollTop,
    composerDraft,
    handleScrollTopChange,
    handleRestoreScrollTopApplied,
    storeCloneScrollRestore,
    stashCloneComposerDraft,
  }
}
