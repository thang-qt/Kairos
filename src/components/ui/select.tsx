'use client'

import { Select as SelectPrimitive } from '@base-ui/react/select'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'

export type SelectOption<T extends string> = {
  value: T
  label: string
  disabled?: boolean
}

type SelectProps<T extends string> = {
  value: T
  options: ReadonlyArray<SelectOption<T>>
  onValueChange: (value: T) => void
  // Accessible name for the trigger when no visible label points at it.
  label?: string
  id?: string
  disabled?: boolean
  className?: string
}

// Single-choice dropdown styled to match the app's menus.
function Select<T extends string>({
  value,
  options,
  onValueChange,
  label,
  id,
  disabled = false,
  className,
}: SelectProps<T>) {
  return (
    <SelectPrimitive.Root
      items={options}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next as T)
      }}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={label}
        className={cn(
          'flex h-9 min-w-0 items-center justify-between gap-2 rounded-lg border border-primary-200 bg-surface px-3 text-left text-sm text-primary-900 outline-none transition-colors hover:border-primary-300 focus-visible:border-primary-400 data-disabled:opacity-60 data-popup-open:border-primary-400',
          className,
        )}
      >
        <SelectPrimitive.Value className="truncate" />
        <SelectPrimitive.Icon className="shrink-0 text-primary-500">
          <HugeiconsIcon icon={ArrowDown01Icon} size={16} strokeWidth={1.5} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          className="z-50 outline-none"
          sideOffset={4}
          alignItemWithTrigger={false}
        >
          <SelectPrimitive.Popup className="max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto rounded-lg bg-primary-50 p-1 text-sm text-primary-900 shadow-lg outline outline-primary-900/10 transition-[opacity,scale] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <SelectPrimitive.List>
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="flex cursor-default items-center justify-between gap-3 rounded-md px-2 py-1.5 font-[450] outline-none select-none data-disabled:opacity-50 data-highlighted:bg-primary-100"
                >
                  <SelectPrimitive.ItemText className="truncate">
                    {option.label}
                  </SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="shrink-0 text-primary-700">
                    <HugeiconsIcon
                      icon={Tick02Icon}
                      size={16}
                      strokeWidth={1.5}
                    />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

export { Select }
