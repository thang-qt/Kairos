import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { GatewayMessage } from '../types'

type UseChatScrollControlInput = {
  displayMessages: Array<GatewayMessage>
  loading: boolean
  pinToTop: boolean
  sessionKey?: string
  headerHeight: number
  slicedLastUserIndex?: number
  lastUserRef: React.MutableRefObject<HTMLDivElement | null>
}

const pendingRestoreSessionKeyRef = { current: undefined } as {
  current: string | undefined
}

export function useChatScrollControl({
  displayMessages,
  loading,
  pinToTop,
  sessionKey,
  headerHeight,
  slicedLastUserIndex,
  lastUserRef,
}: UseChatScrollControlInput) {
  const [viewportNode, setViewportNode] = useState<HTMLDivElement | null>(null)
  const [visibleCount, setVisibleCount] = useState(30)
  const prevLengthRef = useRef(displayMessages.length)
  const prevPinRef = useRef(pinToTop)
  const prevUserIndexRef = useRef<number | undefined>(undefined)

  // Reset when session changes
  useLayoutEffect(() => {
    setVisibleCount(30)
    prevLengthRef.current = displayMessages.length
  }, [sessionKey, displayMessages.length])

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
    const viewport = viewportNode
    if (!viewport) return

    let firstFrame = 0
    let secondFrame = 0

    function scheduleScroll(applyScroll: () => void) {
      applyScroll()
      if (typeof window === 'undefined') return
      firstFrame = window.requestAnimationFrame(function applyFirstFrame() {
        applyScroll()
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
      viewport.scrollTop += nodeRect.top - viewportRect.top - offset
    }

    if (
      pendingRestoreSessionKeyRef.current &&
      pendingRestoreSessionKeyRef.current === sessionKey
    ) {
      pendingRestoreSessionKeyRef.current = undefined
      return
    }

    if (loading) return
    if (pinToTop) {
      const shouldPin =
        !prevPinRef.current || prevUserIndexRef.current !== slicedLastUserIndex
      prevPinRef.current = true
      prevUserIndexRef.current = slicedLastUserIndex
      if (shouldPin && lastUserRef.current) {
        const lastUserNode = lastUserRef.current
        scheduleScroll(function scrollLastUserToTop() {
          scrollNodeToViewportStart(lastUserNode, headerHeight)
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
      viewport.scrollTop = Math.max(
        0,
        viewport.scrollHeight - viewport.clientHeight,
      )
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
    viewportNode,
    lastUserRef,
  ])

  return {
    viewportNode,
    handleViewportNodeChange,
    visibleCount,
    setVisibleCount,
    pendingRestoreSessionKeyRef,
  }
}
