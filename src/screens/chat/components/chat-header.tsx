import { memo } from 'react'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  GitBranchIcon,
  MoreVerticalIcon,
  SidebarLeft01Icon,
} from '@hugeicons/core-free-icons'
import { ContextMeter } from './context-meter'
import { Button } from '@/components/ui/button'
import { ExportMenu } from '@/components/export-menu'
import { cn } from '@/lib/utils'

type ExportFormat = 'markdown' | 'json' | 'text'

type ChatHeaderProps = {
  activeTitle: string
  wrapperRef?: React.Ref<HTMLDivElement>
  isSidebarCollapsed?: boolean
  onOpenSidebar?: () => void
  usedTokens?: number
  maxTokens?: number
  onExport: (format: ExportFormat) => void
  exportDisabled?: boolean
  showExport?: boolean
  forkedFrom?: {
    title: string
    friendlyId?: string
    isOrphaned?: boolean
  }
  onToggleRightSidebar?: () => void
  rightSidebarOpen?: boolean
}

function ChatHeaderComponent({
  activeTitle,
  wrapperRef,
  isSidebarCollapsed = false,
  onOpenSidebar,
  usedTokens,
  maxTokens,
  onExport,
  exportDisabled = false,
  showExport = true,
  forkedFrom,
  onToggleRightSidebar,
  rightSidebarOpen = false,
}: ChatHeaderProps) {
  return (
    <div
      ref={wrapperRef}
      className="px-4 h-12 flex items-center gap-2"
    >
      {isSidebarCollapsed ? (
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onOpenSidebar}
          className="mr-1 text-primary-800 hover:bg-primary-100"
          aria-label="Open sidebar"
        >
          <HugeiconsIcon icon={SidebarLeft01Icon} size={18} strokeWidth={1.6} />
        </Button>
      ) : null}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="text-sm font-medium truncate">
          {activeTitle}
        </span>
        {forkedFrom?.friendlyId ? (
          <Link
            to="/chat/$sessionKey"
            params={{ sessionKey: forkedFrom.friendlyId }}
            className="flex items-center gap-1 text-xs text-primary-500 hover:text-primary-700 shrink-0"
          >
            <HugeiconsIcon icon={GitBranchIcon} size={12} strokeWidth={1.8} />
            <span className="truncate max-w-[120px]">{forkedFrom.title}</span>
          </Link>
        ) : forkedFrom ? (
          <span className="flex items-center gap-1 text-xs text-primary-400 shrink-0">
            <HugeiconsIcon icon={GitBranchIcon} size={12} strokeWidth={1.8} />
            <span className="truncate max-w-[120px]">{forkedFrom.title}</span>
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {showExport ? (
          <ExportMenu onExport={onExport} disabled={exportDisabled} />
        ) : null}
        <ContextMeter usedTokens={usedTokens} maxTokens={maxTokens} />
        {onToggleRightSidebar ? (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onToggleRightSidebar}
            className={cn(
              'text-primary-700 hover:bg-primary-100',
              rightSidebarOpen && 'bg-primary-200 text-primary-900',
            )}
            aria-label="Toggle panel"
          >
            <HugeiconsIcon icon={MoreVerticalIcon} size={20} strokeWidth={1.5} />
          </Button>
        ) : null}
      </div>
    </div>
  )
}

const MemoizedChatHeader = memo(ChatHeaderComponent)

export { MemoizedChatHeader as ChatHeader }
