import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getDesktopBridge } from '@/lib/desktop-bridge'

export function DesktopCloseButton() {
  const bridge = getDesktopBridge()
  if (!bridge) return null

  function closeWindow() {
    void bridge?.closeWindow()
  }

  return (
    <TooltipProvider>
      <TooltipRoot>
        <TooltipTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              className="shrink-0 text-primary-700 hover:bg-primary-100"
              aria-label="Close window"
              onClick={closeWindow}
            />
          }
        >
          <HugeiconsIcon icon={Cancel01Icon} size={20} strokeWidth={1.5} />
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          Close window
        </TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  )
}
