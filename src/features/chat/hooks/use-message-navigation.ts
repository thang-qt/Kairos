import { useCallback } from 'react'
import { useShortcut } from '@/lib/use-shortcut'

type UseMessageNavigationInput = {
  viewportNode: HTMLDivElement | null
  headerHeight: number
}

export function useMessageNavigation({
  viewportNode,
  headerHeight,
}: UseMessageNavigationInput) {
  const navigateMessage = useCallback(
    function navigateMessage(direction: 'up' | 'down') {
      if (!viewportNode) return
      const nodes = Array.from(
        viewportNode.querySelectorAll('[data-message-item]'),
      ) as Array<HTMLElement>
      if (nodes.length === 0) return

      // Find which node is currently active (closest to viewport top)
      const threshold = viewportNode.scrollTop + headerHeight + 24
      let activeIndex = -1

      for (let i = 0; i < nodes.length; i += 1) {
        if (nodes[i].offsetTop <= threshold) {
          activeIndex = i
        } else {
          break
        }
      }
      let targetIndex = activeIndex
      let shouldScrollToBottom = false
      if (direction === 'up') {
        const currentNode = nodes[activeIndex]
        if (
          currentNode &&
          viewportNode.scrollTop >
            currentNode.offsetTop - headerHeight - 12 + 10
        ) {
          targetIndex = activeIndex
        } else {
          targetIndex = Math.max(0, activeIndex - 1)
        }
      } else {
        if (activeIndex === nodes.length - 1) {
          shouldScrollToBottom = true
        } else {
          targetIndex = Math.min(nodes.length - 1, activeIndex + 1)
        }
      }

      if (shouldScrollToBottom) {
        viewportNode.scrollTo({
          top: viewportNode.scrollHeight - viewportNode.clientHeight,
          behavior: 'smooth',
        })
      } else {
        const targetNode = nodes[targetIndex]
        if (!targetNode) return

        const viewportRect = viewportNode.getBoundingClientRect()
        const nodeRect = targetNode.getBoundingClientRect()
        viewportNode.scrollTo({
          top:
            viewportNode.scrollTop +
            nodeRect.top -
            viewportRect.top -
            headerHeight -
            12,
          behavior: 'smooth',
        })
      }
    },
    [viewportNode, headerHeight],
  )

  useShortcut('previousMessage', function previous(event) {
    event.preventDefault()
    navigateMessage('up')
  })
  useShortcut(
    'previousMessage',
    function previous(event) {
      event.preventDefault()
      navigateMessage('up')
    },
    true,
    1,
  )
  useShortcut('nextMessage', function next(event) {
    event.preventDefault()
    navigateMessage('down')
  })
  useShortcut(
    'nextMessage',
    function next(event) {
      event.preventDefault()
      navigateMessage('down')
    },
    true,
    1,
  )
  useShortcut('scrollUp', function up(event) {
    event.preventDefault()
    viewportNode?.scrollBy({ top: -100, behavior: 'smooth' })
  })
  useShortcut('scrollDown', function down(event) {
    event.preventDefault()
    viewportNode?.scrollBy({ top: 100, behavior: 'smooth' })
  })
}
