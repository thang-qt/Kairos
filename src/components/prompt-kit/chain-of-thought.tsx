'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ChainOfThoughtProps = {
  children: React.ReactNode
  className?: string
}

function ChainOfThought({ children, className }: ChainOfThoughtProps) {
  return <div className={cn('w-full space-y-1.5', className)}>{children}</div>
}

type ChainOfThoughtStepProps = {
  children: React.ReactNode
  defaultOpen?: boolean
  className?: string
}

function ChainOfThoughtStep({
  children,
  defaultOpen = false,
  className,
}: ChainOfThoughtStepProps) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <div className={cn('group/step relative', className)}>{children}</div>
    </Collapsible>
  )
}

type ChainOfThoughtTriggerProps = {
  children: React.ReactNode
  leftIcon?: React.ReactNode
  right?: React.ReactNode
  className?: string
  hideChevron?: boolean
}

function ChainOfThoughtTrigger({
  children,
  leftIcon,
  right,
  className,
  hideChevron = false,
}: ChainOfThoughtTriggerProps) {
  return (
    <CollapsibleTrigger
      className="p-0"
      render={
        <Button
          variant="ghost"
          className={cn(
            'group/trigger h-auto w-full justify-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-primary-100/70',
            className,
          )}
        />
      }
    >
      {leftIcon ? (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-600">
          {leftIcon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 whitespace-normal break-words text-sm font-medium leading-snug text-primary-800">
        {children}
      </span>
      {right ? (
        <span className="shrink-0 text-xs text-primary-500">{right}</span>
      ) : null}
      {hideChevron ? null : (
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={14}
          strokeWidth={1.5}
          className="shrink-0 text-primary-500 transition-transform duration-150 group-data-[panel-open]/trigger:rotate-180"
        />
      )}
    </CollapsibleTrigger>
  )
}

type ChainOfThoughtContentProps = {
  children: React.ReactNode
  className?: string
}

function ChainOfThoughtContent({
  children,
  className,
}: ChainOfThoughtContentProps) {
  return (
    <CollapsiblePanel className="ml-4" contentClassName="pt-0">
      <div
        className={cn(
          'ml-2 border-l border-primary-200 py-1 pl-4 text-sm text-primary-700',
          className,
        )}
      >
        <div className="space-y-2">{children}</div>
      </div>
    </CollapsiblePanel>
  )
}

type ChainOfThoughtItemProps = {
  children: React.ReactNode
  className?: string
}

function ChainOfThoughtItem({ children, className }: ChainOfThoughtItemProps) {
  return (
    <div
      className={cn(
        'relative text-sm leading-relaxed text-primary-700',
        className,
      )}
    >
      <span className="absolute -left-[1.18rem] top-2 size-1.5 rounded-full bg-primary-300" />
      {children}
    </div>
  )
}

export {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtItem,
  ChainOfThoughtStep,
  ChainOfThoughtTrigger,
}
