'use client'

import { useEffect, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { LazyMarkdown } from './lazy-markdown'
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'

export type ReasoningCollapseMode =
  | 'collapsed'
  | 'expanded-while-thinking'
  | 'expanded'

export type ThinkingProps = {
  content: string
  isThinking?: boolean
  reasoningCollapseMode?: ReasoningCollapseMode
}

function Thinking({
  content,
  isThinking = false,
  reasoningCollapseMode = 'expanded-while-thinking',
}: ThinkingProps) {
  function getInitialOpen() {
    if (reasoningCollapseMode === 'collapsed') return false
    if (reasoningCollapseMode === 'expanded') return true
    // 'expanded-while-thinking'
    return isThinking
  }

  const [open, setOpen] = useState(getInitialOpen)

  const prevIsThinkingRef = useRef(isThinking)
  const prevCollapseModeRef = useRef(reasoningCollapseMode)

  useEffect(
    function handleThinkingTransition() {
      const prevIsThinking = prevIsThinkingRef.current
      const prevCollapseMode = prevCollapseModeRef.current

      prevIsThinkingRef.current = isThinking
      prevCollapseModeRef.current = reasoningCollapseMode

      if (reasoningCollapseMode !== prevCollapseMode) {
        setOpen(getInitialOpen())
        return
      }

      if (prevIsThinking && !isThinking) {
        if (reasoningCollapseMode === 'expanded-while-thinking') {
          setOpen(false)
        }
      }

      if (!prevIsThinking && isThinking) {
        if (reasoningCollapseMode === 'expanded-while-thinking') {
          setOpen(true)
        }
      }
    },
    [isThinking, reasoningCollapseMode],
  )

  return (
    <div className="inline-flex flex-col">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              className="text-primary-600 h-auto gap-1.5 px-1.5 py-0.5 -mx-2 hover:bg-primary-100/70 hover:text-primary-700"
            />
          }
        >
          <span className="text-sm font-medium text-primary-700">Thinking</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={14}
            strokeWidth={1.5}
            className="text-primary-600 transition-transform duration-150 group-data-panel-open:rotate-180"
          />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="pb-2 pt-0.5">
            <LazyMarkdown className="text-sm text-primary-600 [&_p]:text-primary-600 [&_ul]:text-primary-600 [&_ol]:text-primary-600 [&_li]:text-primary-600 [&_blockquote]:text-primary-600 [&_strong]:text-primary-700 [&_em]:text-primary-600 [&_code]:text-primary-700">
              {content}
            </LazyMarkdown>
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  )
}

export { Thinking }
