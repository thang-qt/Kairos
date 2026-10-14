import { useEffect, useRef, useState } from 'react'
import { useShortcut } from '@/lib/use-shortcut'
import { textFromMessage } from '../utils'
import type { ConversationTurn } from '../types'
import { lastFencedCodeBlock } from '@/lib/shortcuts-code'

export function ConversationShortcuts({
  messages,
}: {
  messages: Array<ConversationTurn>
}) {
  const [status, setStatus] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(function cleanupTimer() {
    return function cleanup() {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])
  async function copy(codeOnly: boolean) {
    const turn = messages.findLast(function assistant(turn) {
      return turn.role === 'assistant'
    })
    if (!turn) return
    const text = textFromMessage(turn)
    const content = codeOnly ? lastFencedCodeBlock(text) : text
    if (content === null || (!codeOnly && !content)) return
    try {
      await navigator.clipboard.writeText(content)
      if (timer.current) clearTimeout(timer.current)
      setStatus(codeOnly ? 'Code copied' : 'Response copied')
      timer.current = setTimeout(function clearStatus() {
        setStatus('')
      }, 1400)
    } catch {
      setStatus('Could not copy')
    }
  }
  useShortcut('copyResponse', function copyResponse(event) {
    event.preventDefault()
    void copy(false)
  })
  useShortcut('copyCode', function copyCode(event) {
    event.preventDefault()
    void copy(true)
  })
  return (
    <div
      role="status"
      className="pointer-events-none absolute inset-x-0 bottom-24 z-20 text-center text-pretty text-xs text-primary-600"
    >
      {status}
    </div>
  )
}
