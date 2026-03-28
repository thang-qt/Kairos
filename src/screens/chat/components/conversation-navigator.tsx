import { useEffect, useMemo, useState } from 'react'
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export type ConversationNavigatorTurn = {
  id: string
  preview: string
}

type ConversationNavigatorProps = {
  turns: Array<ConversationNavigatorTurn>
  headerHeight: number
  scrollElement: HTMLDivElement | null
  getTurnNode: (turnId: string) => HTMLDivElement | null
}

const MAX_VISIBLE_TURNS = 12

function truncatePreview(preview: string, maxLength: number): string {
  if (preview.length <= maxLength) return preview
  return `${preview.slice(0, maxLength).trimEnd()}...`
}

export function ConversationNavigator({
  turns,
  headerHeight,
  scrollElement,
  getTurnNode,
}: ConversationNavigatorProps) {
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null)

  const activeTurnIds = useMemo(
    () => new Set(turns.map((turn) => turn.id)),
    [turns],
  )

  useEffect(() => {
    if (!activeTurnId || activeTurnIds.has(activeTurnId)) return
    setActiveTurnId(turns[0]?.id ?? null)
  }, [activeTurnId, activeTurnIds, turns])

  const visibleTurns = useMemo(() => {
    if (turns.length <= MAX_VISIBLE_TURNS) return turns

    const activeIndex = turns.findIndex((turn) => turn.id === activeTurnId)
    if (activeIndex < 0) {
      return turns.slice(Math.max(0, turns.length - MAX_VISIBLE_TURNS))
    }

    const halfWindow = Math.floor(MAX_VISIBLE_TURNS / 2)
    const maxStart = Math.max(0, turns.length - MAX_VISIBLE_TURNS)
    const start = Math.min(
      maxStart,
      Math.max(0, activeIndex - halfWindow),
    )

    return turns.slice(start, start + MAX_VISIBLE_TURNS)
  }, [activeTurnId, turns])

  useEffect(() => {
    if (!scrollElement || turns.length === 0) {
      setActiveTurnId(null)
      return
    }

    const activeScrollElement = scrollElement

    function updateActiveTurn() {
      const threshold = activeScrollElement.scrollTop + headerHeight + 24
      let nextActiveTurnId = turns[0]?.id ?? null

      for (const turn of turns) {
        const node = getTurnNode(turn.id)
        if (!node) continue
        if (node.offsetTop <= threshold) {
          nextActiveTurnId = turn.id
          continue
        }
        break
      }

      setActiveTurnId((previous) =>
        previous === nextActiveTurnId ? previous : nextActiveTurnId,
      )
    }

    updateActiveTurn()
    activeScrollElement.addEventListener('scroll', updateActiveTurn, {
      passive: true,
    })
    window.addEventListener('resize', updateActiveTurn)

    return function cleanupActiveTurn() {
      activeScrollElement.removeEventListener('scroll', updateActiveTurn)
      window.removeEventListener('resize', updateActiveTurn)
    }
  }, [getTurnNode, headerHeight, scrollElement, turns])

  function handleTurnClick(turnId: string) {
    const node = getTurnNode(turnId)
    if (!node) return
    node.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function handleTurnPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    event.currentTarget.blur()
  }

  if (turns.length === 0) return null

  return (
    <div
      className="group/nav-rail pointer-events-none absolute right-4 bottom-0 z-20 hidden w-28 md:block"
      style={{ top: `${headerHeight}px` }}
    >
      <div className="flex h-full items-center justify-end">
        <div className="pointer-events-auto overflow-visible py-2 opacity-0 transition-opacity duration-150 ease-out group-hover/nav-rail:opacity-100 group-focus-within/nav-rail:opacity-100 hover:opacity-100">
          <div className="overflow-x-visible">
            <div className="flex flex-col gap-2.5">
              <TooltipProvider>
                {visibleTurns.map((turn) => {
                  const isActive = turn.id === activeTurnId
                  const preview = truncatePreview(turn.preview, 140)
                  const turnIndex = turns.findIndex(
                    (candidate) => candidate.id === turn.id,
                  )

                  return (
                    <TooltipRoot key={turn.id}>
                      <div className="group/nav-item relative flex min-h-6 flex-col items-end justify-center">
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              aria-label={`Jump to user turn ${turnIndex + 1}`}
                              onClick={function handleClick() {
                                handleTurnClick(turn.id)
                              }}
                              onPointerUp={handleTurnPointerUp}
                              className={cn(
                                'block h-4 rounded-full bg-transparent py-[7px] transition-all duration-150 ease-out hover:w-16 focus-visible:w-16 focus-visible:outline-none',
                                isActive ? 'w-14' : 'w-10',
                              )}
                            >
                              <span
                                className={cn(
                                  'block h-px w-full rounded-full bg-primary-300 transition-colors duration-150 ease-out group-hover/nav-item:bg-primary-700 group-focus-within/nav-item:bg-primary-700',
                                  isActive && 'bg-primary-500',
                                )}
                              />
                            </button>
                          }
                        />
                        <TooltipContent
                          side="left"
                          align="start"
                          className="max-w-44 border-primary-200 bg-primary-50 text-right text-primary-800"
                        >
                          <span className="block break-words text-pretty">
                            {preview}
                          </span>
                        </TooltipContent>
                      </div>
                    </TooltipRoot>
                  )
                })}
              </TooltipProvider>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
