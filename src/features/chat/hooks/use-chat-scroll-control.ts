import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { getGatewayMessageId } from '../utils'
import type { GatewayMessage } from '../types'

type UseChatScrollControlInput = {
  displayMessages: Array<GatewayMessage>
  loading: boolean
  pinToTop: boolean
  sessionKey?: string
  targetMessageId?: string
  headerHeight: number
  slicedLastUserIndex?: number
  lastUserRef: React.MutableRefObject<HTMLDivElement | null>
  responseAfterLastUserRef?: React.MutableRefObject<HTMLDivElement | null>
  onTargetMessageReached?: (messageId: string) => void
}

export function targetVisibleCount(
  displayMessages: Array<GatewayMessage>,
  targetMessageId: string,
): number | undefined {
  const targetIndex = displayMessages.findIndex(function findTarget(message) {
    return getGatewayMessageId(message) === targetMessageId
  })
  return targetIndex < 0 ? undefined : displayMessages.length - targetIndex
}

function findMessageNode(
  viewport: HTMLDivElement,
  messageId: string,
): HTMLElement | undefined {
  return Array.from(viewport.querySelectorAll('[data-message-item]')).find(
    function matchesMessageId(node) {
      return node instanceof HTMLElement && node.dataset.messageId === messageId
    },
  ) as HTMLElement | undefined
}

const pendingRestoreSessionKeyRef = { current: undefined } as {
  current: string | undefined
}

export function useChatScrollControl({
  displayMessages,
  loading,
  pinToTop,
  sessionKey,
  targetMessageId,
  headerHeight,
  slicedLastUserIndex,
  lastUserRef,
  responseAfterLastUserRef,
  onTargetMessageReached,
}: UseChatScrollControlInput) {
  const [viewportNode, setViewportNode] = useState<HTMLDivElement | null>(null)
  const [visibleCount, setVisibleCount] = useState(30)
  const prevLengthRef = useRef(displayMessages.length)
  const prevPinRef = useRef(pinToTop)
  const prevUserIndexRef = useRef<number | undefined>(undefined)
  const pendingResponsePinUserIndexRef = useRef<number | undefined>(undefined)
  const consumedTargetKeyRef = useRef<string | undefined>(undefined)
  const targetKey = targetMessageId
    ? `${sessionKey ?? ''}\u0000${targetMessageId}`
    : undefined

  // Reset only when the session changes so expanded history stays mounted.
  useLayoutEffect(() => {
    setVisibleCount(30)
    prevLengthRef.current = displayMessages.length
  }, [sessionKey])

  // Increase visibleCount when new messages are appended at the end
  useLayoutEffect(() => {
    const diff = displayMessages.length - prevLengthRef.current
    if (diff > 0) {
      setVisibleCount((prev) => prev + diff)
    }
    prevLengthRef.current = displayMessages.length
  }, [displayMessages.length])

  const handleScroll = useCallback(() => {
    const viewport = viewportNode
    if (!viewport) return

    if (viewport.scrollTop < 80 && visibleCount < displayMessages.length) {
      const prevScrollHeight = viewport.scrollHeight
      const prevScrollTop = viewport.scrollTop

      setVisibleCount((prev) => {
        const next = Math.min(displayMessages.length, prev + 30)
        requestAnimationFrame(() => {
          const nextScrollHeight = viewport.scrollHeight
          viewport.scrollTop =
            prevScrollTop + (nextScrollHeight - prevScrollHeight)
        })
        return next
      })
    }
  }, [viewportNode, visibleCount, displayMessages.length])

  useEffect(() => {
    const viewport = viewportNode
    if (!viewport) return

    viewport.addEventListener('scroll', handleScroll, { passive: true })
    return () => viewport.removeEventListener('scroll', handleScroll)
  }, [viewportNode, handleScroll])

  const handleViewportNodeChange = useCallback(
    function handleViewportNodeChange(node: HTMLDivElement | null) {
      setViewportNode(node)
    },
    [],
  )

  useLayoutEffect(() => {
    if (!targetKey) {
      consumedTargetKeyRef.current = undefined
      return
    }
    if (consumedTargetKeyRef.current === targetKey || loading) return

    const requiredVisibleCount = targetVisibleCount(
      displayMessages,
      targetMessageId ?? '',
    )
    if (requiredVisibleCount === undefined) {
      consumedTargetKeyRef.current = targetKey
      return
    }
    if (visibleCount < requiredVisibleCount) {
      setVisibleCount(function expandToTarget(previousCount) {
        return Math.max(previousCount, requiredVisibleCount)
      })
      return
    }

    if (!viewportNode) return
    const viewport = viewportNode

    let firstFrame = 0
    let secondFrame = 0
    let attempts = 0

    function alignTarget(): boolean {
      const targetNode = findMessageNode(viewport, targetMessageId ?? '')
      if (!targetNode) return false

      const viewportRect = viewport.getBoundingClientRect()
      const targetRect = targetNode.getBoundingClientRect()
      const scrollTop = Math.max(
        0,
        viewport.scrollTop +
          targetRect.top -
          viewportRect.top -
          headerHeight -
          12,
      )
      viewport.scrollTop = scrollTop
      return true
    }

    function scrollToTarget() {
      if (!alignTarget()) {
        attempts += 1
        if (attempts < 2 && typeof window !== 'undefined') {
          firstFrame = window.requestAnimationFrame(scrollToTarget)
          return
        }
        consumedTargetKeyRef.current = targetKey
        return
      }

      consumedTargetKeyRef.current = targetKey
      onTargetMessageReached?.(targetMessageId ?? '')
      if (typeof window !== 'undefined') {
        secondFrame = window.requestAnimationFrame(function realignTarget() {
          alignTarget()
        })
      }
    }

    if (typeof window === 'undefined') {
      scrollToTarget()
    } else {
      firstFrame = window.requestAnimationFrame(scrollToTarget)
    }

    return function cancelTargetScroll() {
      if (firstFrame) window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
    }
  }, [
    displayMessages,
    headerHeight,
    loading,
    onTargetMessageReached,
    targetKey,
    targetMessageId,
    viewportNode,
    visibleCount,
  ])

  useLayoutEffect(() => {
    const viewport = viewportNode
    if (!viewport) return

    let firstFrame = 0
    let secondFrame = 0

    function scheduleScroll(applyScroll: () => boolean) {
      if (typeof window === 'undefined') {
        applyScroll()
        return
      }

      firstFrame = window.requestAnimationFrame(function applyFirstFrame() {
        if (applyScroll()) return
        secondFrame = window.requestAnimationFrame(function applySecondFrame() {
          applyScroll()
        })
      })
    }

    const scrollNodeToViewportStart = function scrollNodeToViewportStart(
      node: HTMLElement,
      offset: number,
    ) {
      const viewportRect = viewport.getBoundingClientRect()
      const nodeRect = node.getBoundingClientRect()
      const delta = nodeRect.top - viewportRect.top - offset
      if (Math.abs(delta) < 1) return false
      viewport.scrollTop = Math.max(0, viewport.scrollTop + delta)
      return true
    }

    if (
      pendingRestoreSessionKeyRef.current &&
      pendingRestoreSessionKeyRef.current === sessionKey
    ) {
      pendingRestoreSessionKeyRef.current = undefined
      return
    }

    if (loading) return
    if (targetKey && consumedTargetKeyRef.current !== targetKey) return
    if (pinToTop) {
      const shouldPin =
        !prevPinRef.current || prevUserIndexRef.current !== slicedLastUserIndex
      prevPinRef.current = true
      prevUserIndexRef.current = slicedLastUserIndex
      if (shouldPin) {
        scheduleScroll(function scrollLastUserOrResponseToTop() {
          const lastUserNode = lastUserRef.current
          if (!lastUserNode) return false

          const visibleHeight = Math.max(
            0,
            viewport.clientHeight - headerHeight,
          )
          const longMessageThreshold = Math.max(240, visibleHeight * 0.45)
          const isLongUserMessage =
            lastUserNode.getBoundingClientRect().height > longMessageThreshold

          if (isLongUserMessage) {
            const responseNode = responseAfterLastUserRef?.current
            if (responseNode) {
              pendingResponsePinUserIndexRef.current = undefined
              return scrollNodeToViewportStart(responseNode, headerHeight + 12)
            }
            pendingResponsePinUserIndexRef.current = slicedLastUserIndex
          }

          return scrollNodeToViewportStart(lastUserNode, headerHeight + 12)
        })
      } else if (
        pendingResponsePinUserIndexRef.current === slicedLastUserIndex &&
        responseAfterLastUserRef?.current
      ) {
        const responseNode = responseAfterLastUserRef.current
        pendingResponsePinUserIndexRef.current = undefined
        scheduleScroll(function scrollResponseToTop() {
          return scrollNodeToViewportStart(responseNode, headerHeight + 12)
        })
      }
      return function cleanupScrollFrames() {
        window.cancelAnimationFrame(firstFrame)
        window.cancelAnimationFrame(secondFrame)
      }
    }

    prevPinRef.current = false
    prevUserIndexRef.current = slicedLastUserIndex
    scheduleScroll(function scrollToBottom() {
      const nextScrollTop = Math.max(
        0,
        viewport.scrollHeight - viewport.clientHeight,
      )
      if (Math.abs(viewport.scrollTop - nextScrollTop) < 1) return false
      viewport.scrollTop = nextScrollTop
      return true
    })
    return function cleanupScrollFrames() {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
    }
  }, [
    displayMessages,
    headerHeight,
    slicedLastUserIndex,
    loading,
    pinToTop,
    sessionKey,
    targetKey,
    viewportNode,
    lastUserRef,
    responseAfterLastUserRef,
  ])

  return {
    viewportNode,
    handleViewportNodeChange,
    visibleCount,
    setVisibleCount,
    pendingRestoreSessionKeyRef,
  }
}
