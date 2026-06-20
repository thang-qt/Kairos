import { useCallback, useState } from 'react'
import { useHotkey } from '@tanstack/react-hotkeys'
import { isEditableTarget } from '../components/chat-message-list-utils'

type UseMessageNavigationInput = {
  viewportNode: HTMLDivElement | null
  headerHeight: number
}

export function useMessageNavigation({
  viewportNode,
  headerHeight,
}: UseMessageNavigationInput) {
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false)

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

  useHotkey(
    'Alt+ArrowUp',
    function handleAltArrowUp(event) {
      event.preventDefault()
      navigateMessage('up')
    },
    { preventDefault: true },
  )

  useHotkey(
    'Alt+ArrowDown',
    function handleAltArrowDown(event) {
      event.preventDefault()
      navigateMessage('down')
    },
    { preventDefault: true },
  )

  useHotkey('K', function handleKeyK(event) {
    if (isEditableTarget(event.target)) return
    event.preventDefault()
    if (!viewportNode) return
    viewportNode.scrollBy({
      top: -100,
      behavior: 'smooth',
    })
  })

  useHotkey('J', function handleKeyJ(event) {
    if (isEditableTarget(event.target)) return
    event.preventDefault()
    if (!viewportNode) return
    viewportNode.scrollBy({
      top: 100,
      behavior: 'smooth',
    })
  })

  useHotkey('[', function handleLeftBracket(event) {
    if (isEditableTarget(event.target)) return
    event.preventDefault()
    navigateMessage('up')
  })

  useHotkey(']', function handleRightBracket(event) {
    if (isEditableTarget(event.target)) return
    event.preventDefault()
    navigateMessage('down')
  })

  useHotkey({ key: '?', shift: true }, function handleQuestionMark(event) {
    if (isEditableTarget(event.target)) return
    event.preventDefault()
    setShortcutsHelpOpen((prev) => !prev)
  })

  return {
    shortcutsHelpOpen,
    setShortcutsHelpOpen,
  }
}
