'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'

export type ThinkingProps = {
  content: string
}

function Thinking({ content }: ThinkingProps) {
  return (
    <div className="inline-flex flex-col">
      <Collapsible>
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
            <p className="text-sm text-primary-600 whitespace-pre-wrap">
              {content}
            </p>
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  )
}

export { Thinking }
